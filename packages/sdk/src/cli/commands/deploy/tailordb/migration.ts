/**
 * Migration execution service for TailorDB migrations
 *
 * Handles detection and execution of pending migration scripts. Every migration
 * runs as a temporary workflow job so its duration is not bound by the
 * synchronous function-execution deadline.
 */

import * as fs from "node:fs";
import { create } from "@bufbuild/protobuf";
import {
  AuthInvokerSchema,
  type AuthInvoker,
} from "@tailor-platform/tailor-proto/auth_resource_pb";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
  type WorkflowExecution,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import {
  bundleMigrationScript,
  bundleMigrationSteps,
} from "#/cli/commands/tailordb/migrate/bundler";
import { type NamespaceWithMigrations } from "#/cli/commands/tailordb/migrate/config";
import { formatMigrationScriptHint } from "#/cli/commands/tailordb/migrate/hints";
import {
  fetchRemoteMigrationState,
  type MigrationInProgress,
  type RemoteMigrationState,
} from "#/cli/commands/tailordb/migrate/remote-state";
import {
  analyzeMigrationScript,
  ignoredStepsWarning,
} from "#/cli/commands/tailordb/migrate/script-form";
import {
  loadDiff,
  getMigrationFiles,
  getMigrationFilePath,
  formatMigrationNumber,
} from "#/cli/commands/tailordb/migrate/snapshot";
import {
  type PendingMigration,
  executionIdToLabel,
  MIGRATION_EXECUTION_LABEL_KEY,
  MIGRATION_HISTORY_LABEL_KEY,
  MIGRATION_IN_PROGRESS_LABEL_KEY,
  MIGRATION_LABEL_KEY,
  sanitizeMigrationLabel,
} from "#/cli/commands/tailordb/migrate/types";
import { type OperatorClient } from "#/cli/shared/client";
import { CLIError, isCLIError } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { spinner } from "#/cli/shared/spinner";
import { resourceTrn, writeMetadataLabelsDirect } from "../label";
import { formatDuration, ScriptRunTimer, type MaintenanceTimeline } from "./migration-timing";
import {
  executeMigrationAsWorkflow,
  executeMigrationStepsAsWorkflow,
  migrationStepRunnerName,
  migrationWorkflowResourceName,
  type MigrationRunEvent,
  type MigrationStepsWorkflowResult,
} from "./migration-workflow";
import type { MigrationScriptForm } from "#/cli/commands/tailordb/migrate/script-form";
import type { Spinner } from "#/cli/shared/spinner";
import type { TailorDBServiceConfig } from "#/types/tailordb.generated";

// ============================================================================
// Types
// ============================================================================

interface MigrationExecutionOptions {
  client: OperatorClient;
  workspaceId: string;
  invoker: AuthInvoker;
  env: Record<string, string | number | boolean>;
  configDir: string;
  appName: string;
  appId: string | undefined;
}

/**
 * Context for migration execution with per-namespace configuration
 */
export interface MigrationContext {
  client: OperatorClient;
  workspaceId: string;
  authNamespace: string;
  machineUsers: string[] | undefined;
  dbConfig: Record<string, TailorDBServiceConfig | undefined>;
  env: Record<string, string | number | boolean>;
  configDir: string;
  /** Application name, used to label a migration's temporary resources. */
  appName: string;
  /** Application id, used to label a migration's temporary resources. */
  appId: string | undefined;
}

interface ExecutionResult {
  namespace: string;
  migrationNumber: number;
  success: boolean;
  logs?: string;
  error?: string;
  /** Thrown in place of a plain migration failure once the logs are shown. */
  failure?: Error;
}

// ============================================================================
// Migration Detection
// ============================================================================

/**
 * Get the current migration label from TailorDB Service metadata
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {string} namespace - TailorDB namespace
 * @param remoteStates - Collects the namespace's full migration state when given
 * @returns {Promise<number>} Current migration number (0 if none)
 */
async function getCurrentMigrationNumber(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
  remoteStates: Map<string, RemoteMigrationState> | undefined,
): Promise<number> {
  const state = await fetchRemoteMigrationState(
    client,
    resourceTrn(workspaceId, "tailordb", namespace),
  );
  remoteStates?.set(namespace, state);
  return state.number ?? 0;
}

/**
 * Detect pending migrations that need to be executed
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {NamespaceWithMigrations[]} namespacesWithMigrations - Namespaces with migrations config
 * @param {string} [configPath] - Config file path, included in remediation guidance when provided
 * @param {ReadonlyMap<string, number>} [currentMigrationOverrides] - Confirmed current migration numbers to use instead of remote metadata
 * @param [remoteStates] - Collects the remote migration state of each namespace read from metadata
 * @returns {Promise<PendingMigration[]>} List of pending migrations
 */
export async function detectPendingMigrations(
  client: OperatorClient,
  workspaceId: string,
  namespacesWithMigrations: NamespaceWithMigrations[],
  configPath?: string,
  currentMigrationOverrides?: ReadonlyMap<string, number>,
  remoteStates?: Map<string, RemoteMigrationState>,
): Promise<PendingMigration[]> {
  const pendingMigrations: PendingMigration[] = [];

  for (const { namespace, migrationsDir } of namespacesWithMigrations) {
    // Get current applied migration number
    const currentMigration =
      currentMigrationOverrides?.get(namespace) ??
      (await getCurrentMigrationNumber(client, workspaceId, namespace, remoteStates));

    // Get all migration files
    const migrationFiles = getMigrationFiles(migrationsDir);

    // Find migrations that haven't been applied yet
    for (const file of migrationFiles) {
      if (file.number <= currentMigration) {
        continue;
      }

      // Check for diff file (all migrations must have a diff)
      const diffPath = getMigrationFilePath(migrationsDir, file.number, "diff");
      if (!fs.existsSync(diffPath)) {
        continue;
      }

      // Load the diff to inspect breaking/warning classification
      const diff = loadDiff(diffPath);

      // The migration script is executed when migrate.ts exists on disk.
      // Breaking changes hard-require a script unless the user recorded an
      // explicit skip acknowledgment; warnings (e.g. field_removed) may
      // optionally have one added via `tailordb migration script <num>`.
      const scriptPath = getMigrationFilePath(migrationsDir, file.number, "migrate");
      const hasScript = fs.existsSync(scriptPath);
      if (diff.requiresMigrationScript && !hasScript && !diff.scriptSkipped) {
        const commandOptions = { migrationNumber: file.number, namespace, configPath };
        throw CLIError({
          code: "MIGRATION_SCRIPT_REQUIRED",
          message: `Migration ${namespace}/${formatMigrationNumber(file.number)} requires a migration script but migrate.ts was not found.`,
          suggestion: `Add a script: ${formatMigrationScriptHint(commandOptions)}\nOr record that no script is needed: ${formatMigrationScriptHint({ ...commandOptions, noScript: true })}`,
        });
      }
      if (diff.scriptSkipped) {
        const migrationLabel = `${namespace}/${formatMigrationNumber(file.number)}`;
        if (hasScript) {
          throw CLIError({
            code: "MIGRATION_SCRIPT_SKIP_CONFLICT",
            message: `Migration ${migrationLabel} has both a --no-script skip acknowledgment and migrate.ts.`,
            suggestion: `Keep the script and clear the stale acknowledgment: ${formatMigrationScriptHint({ migrationNumber: file.number, namespace, configPath })}\nOr keep the skip: delete migrate.ts`,
          });
        }
        logger.info(
          `Migration ${migrationLabel} runs without a script (skip acknowledged at ${diff.scriptSkipped.acknowledgedAt}: ${diff.scriptSkipped.reason})`,
        );
      }

      const scriptForm = hasScript ? analyzeMigrationScript(scriptPath) : null;
      if (scriptForm?.kind === "main" && scriptForm.ignoredSteps) {
        logger.warn(ignoredStepsWarning(`${namespace}/${formatMigrationNumber(file.number)}`));
      }
      pendingMigrations.push({
        number: file.number,
        scriptPath,
        hasScript,
        scriptForm,
        diffPath,
        namespace,
        migrationsDir,
        diff,
      });
    }
  }

  // Sort by namespace and migration number
  return pendingMigrations.toSorted((a, b) => {
    if (a.namespace !== b.namespace) {
      return a.namespace.localeCompare(b.namespace);
    }
    return a.number - b.number;
  });
}

// ============================================================================
// Migration Execution
// ============================================================================

/** Receives a migration run's progress for display and timing. */
interface MigrationRunDisplay {
  onRunEvent: (event: MigrationRunEvent) => void;
  onProgress: (completedSteps: number, totalSteps: number) => void;
}

function describeRunStatus(execution: WorkflowExecution): string {
  const jobs = execution.jobExecutions.map((job) => {
    const name = job.kind.case === "jobFunction" ? job.kind.value.name : (job.kind.case ?? "job");
    return `${name}=${WorkflowJobExecution_Status[job.status]}`;
  });
  return `workflow execution ${WorkflowExecution_Status[execution.status]}, ${
    jobs.length > 0 ? `jobs ${jobs.join(", ")}` : "no jobs yet"
  }`;
}

/**
 * Time a migration run's phases and show what it is doing.
 * @param migrationLabel - Migration shown in messages, e.g. `tailordb/0001`
 * @param timer - Timer of the run
 * @param sp - Spinner showing the run
 * @returns Callbacks for the run's progress
 */
function displayMigrationRun(
  migrationLabel: string,
  timer: ScriptRunTimer,
  sp: Spinner,
): MigrationRunDisplay {
  let steps = "";
  let lastStatus: string | undefined;
  const aside = (write: () => void) => {
    sp.stop();
    write();
    sp.start();
  };
  const debug = (message: string) => {
    if (logger.verbose) aside(() => logger.debug(message));
  };
  const render = (at: number) => {
    const elapsed = formatDuration(at - timer.phaseStartedAt);
    sp.text =
      timer.phase === "running"
        ? `Running migration ${migrationLabel} (${steps}${elapsed})...`
        : `Waiting for a job of migration ${migrationLabel} to start (${steps}${elapsed})...`;
  };
  return {
    onRunEvent: (event) => {
      if (event.type === "finished") {
        if (event.scriptStarted && !timer.startObserved) timer.running(event.at);
        timer.finished(event.at);
        if (!timer.startObserved) {
          debug(
            `Could not observe when migration ${migrationLabel} started running, so its run is not split into waiting and running.`,
          );
        }
        return;
      }
      const firstStart = event.type === "running" && !timer.startObserved;
      if (event.type === "waiting") timer.waiting(event.at);
      if (event.type === "running") timer.running(event.at);
      render(event.at);
      if (firstStart) {
        aside(() =>
          logger.info(
            `Migration ${migrationLabel} started running after waiting ${formatDuration(timer.waitedMs)} for its job to start.`,
            { mode: "stream" },
          ),
        );
      }
      if (event.type === "polled") {
        const status = describeRunStatus(event.execution);
        if (status !== lastStatus) debug(`Migration ${migrationLabel}: ${status}.`);
        lastStatus = status;
      }
    },
    onProgress: (completed, total) => {
      steps = `${completed}/${total} steps completed, `;
      render(performance.now());
    },
  };
}

/**
 * Execute a single migration script
 * @param {MigrationExecutionOptions} options - Execution options
 * @param {PendingMigration} migration - Migration to execute
 * @param inProgress - What an earlier deploy recorded for this migration, if anything
 * @param sp - Spinner showing progress
 * @param display - Receives the run's progress
 * @returns {Promise<ExecutionResult>} Execution result
 */
async function executeSingleMigration(
  options: MigrationExecutionOptions,
  migration: PendingMigration,
  inProgress: MigrationInProgress | undefined,
  sp: Spinner,
  display: MigrationRunDisplay,
): Promise<ExecutionResult> {
  const { client, workspaceId, invoker, env, configDir, appName, appId } = options;
  if (migration.scriptForm?.kind === "steps") {
    return executeStepsMigration(options, migration, migration.scriptForm, inProgress, sp, display);
  }

  // Bundle the migration script
  const bundleResult = await bundleMigrationScript(
    migration.scriptPath,
    migration.namespace,
    migration.number,
    env,
    configDir,
    migration.diff.temporal ?? false,
    migration.diff.dateRepresentation ?? "legacy",
  );

  const result = await executeMigrationAsWorkflow({
    client,
    workspaceId,
    code: bundleResult.bundledCode,
    namespace: migration.namespace,
    migrationNumber: migration.number,
    invoker,
    appName,
    appId,
    onRunEvent: display.onRunEvent,
  });

  return {
    namespace: migration.namespace,
    migrationNumber: migration.number,
    success: result.success,
    logs: result.logs,
    error: result.error,
  };
}

/**
 * Update the migration label on TailorDB Service metadata
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {string} namespace - TailorDB namespace
 * @param {number} migrationNumber - Migration number to set
 * @param historyId - Optional migration history ID to set atomically with the checkpoint
 * @returns Whether the labels changed
 */
export async function updateMigrationLabel(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
  migrationNumber: number,
  historyId?: string,
): Promise<boolean> {
  const trn = resourceTrn(workspaceId, "tailordb", namespace);

  return writeMetadataLabelsDirect(client, {
    trn,
    labels: {
      [MIGRATION_LABEL_KEY]: sanitizeMigrationLabel(migrationNumber),
      ...(historyId ? { [MIGRATION_HISTORY_LABEL_KEY]: historyId } : {}),
    },
    remove: [
      ...(historyId ? [] : [MIGRATION_HISTORY_LABEL_KEY]),
      MIGRATION_IN_PROGRESS_LABEL_KEY,
      MIGRATION_EXECUTION_LABEL_KEY,
    ],
  });
}

/**
 * Record that a multi-step migration is running, so a deploy that stops or
 * fails after a step committed leaves the next deploy able to resume it.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param namespace - TailorDB namespace
 * @param migrationNumber - Migration being applied
 * @param executionId - The execution running it, once started
 */
async function writeMigrationInProgress(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
  migrationNumber: number,
  executionId?: string,
): Promise<void> {
  await writeMetadataLabelsDirect(client, {
    trn: resourceTrn(workspaceId, "tailordb", namespace),
    labels: {
      [MIGRATION_IN_PROGRESS_LABEL_KEY]: sanitizeMigrationLabel(migrationNumber),
      ...(executionId ? { [MIGRATION_EXECUTION_LABEL_KEY]: executionIdToLabel(executionId) } : {}),
    },
    remove: executionId ? undefined : [MIGRATION_EXECUTION_LABEL_KEY],
  });
}

/**
 * Remove the in-progress record without moving the checkpoint.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param namespace - TailorDB namespace
 */
export async function clearMigrationInProgress(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
): Promise<void> {
  await writeMetadataLabelsDirect(client, {
    trn: resourceTrn(workspaceId, "tailordb", namespace),
    labels: {},
    remove: [MIGRATION_IN_PROGRESS_LABEL_KEY, MIGRATION_EXECUTION_LABEL_KEY],
  });
}

/**
 * Whether a migration failure left steps committed, so its schema changes
 * must stay in place for the next deploy to resume.
 * @param error - Failure raised while executing migrations
 * @returns True for a partially applied migration
 */
export function isMigrationPartiallyApplied(error: unknown): boolean {
  return isCLIError(error) && error.code === "MIGRATION_PARTIALLY_APPLIED";
}

function partiallyAppliedError(
  migration: PendingMigration,
  result: Pick<MigrationStepsWorkflowResult, "completedSteps" | "failedSteps" | "executionId">,
  cause: unknown,
): Error {
  const migrationLabel = `${migration.namespace}/${formatMigrationNumber(migration.number)}`;
  const failed = result.failedSteps.length > 0 ? ` at ${result.failedSteps.join(", ")}` : "";
  const completed =
    result.completedSteps.length > 0
      ? ` after ${result.completedSteps.join(", ")} completed`
      : " after some steps may have completed";
  return CLIError({
    code: "MIGRATION_PARTIALLY_APPLIED",
    message: `Migration ${migrationLabel} failed${failed}${completed}: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
    suggestion:
      `${
        isCLIError(cause) && cause.suggestion
          ? cause.suggestion
          : "Fix the failing step in migrate.ts and deploy again; steps that already completed do not run again."
      } ` +
      `Until the migration completes, the tables of namespace '${migration.namespace}' stay in maintenance mode, as during the migration.`,
    context: {
      namespace: migration.namespace,
      migrationNumber: migration.number,
      completedSteps: result.completedSteps,
      failedSteps: result.failedSteps,
      ...(result.executionId ? { executionId: result.executionId } : {}),
    },
    cause,
  });
}

function unreleasedRecordError(
  migration: PendingMigration,
  cause: unknown,
  recordConfirmed: boolean,
): Error {
  const { namespace } = migration;
  const number = formatMigrationNumber(migration.number);
  const checkpoint = formatMigrationNumber(migration.number - 1);
  const next = recordConfirmed
    ? "Its in-progress record could not be cleared, so its pre-migration schema stays in place and the next deploy runs every step again. Fix the failure and deploy again."
    : `Whether it is still recorded as in progress could not be confirmed, so its pre-migration schema stays in place. ` +
      `Run 'tailor tailordb migration status --namespace ${namespace}': if it reports migration ${number} in progress, fix the failure and deploy again; ` +
      `otherwise run 'tailor tailordb migration sync ${checkpoint} --namespace ${namespace}' to return the schema to migration ${checkpoint}, then deploy again.`;
  return CLIError({
    code: "MIGRATION_PARTIALLY_APPLIED",
    message: `Migration ${namespace}/${number} failed before any step completed: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
    suggestion: `${next} Until then, the tables of namespace '${namespace}' stay in maintenance mode, as during the migration.`,
    context: { namespace, migrationNumber: migration.number, completedSteps: [], failedSteps: [] },
    cause,
  });
}

function unconfirmedStartError(migration: PendingMigration, cause: CLIError): Error {
  return CLIError({
    code: "MIGRATION_PARTIALLY_APPLIED",
    message: cause.message,
    suggestion:
      `${cause.suggestion ? `${cause.suggestion} ` : ""}` +
      `Until the migration completes, the tables of namespace '${migration.namespace}' stay in maintenance mode, as during the migration.`,
    context: {
      namespace: migration.namespace,
      migrationNumber: migration.number,
      completedSteps: [],
      failedSteps: [],
    },
    cause,
  });
}

/**
 * Clear the in-progress record of a migration whose steps did not commit.
 * When the record may remain, the migration stays in progress so the
 * Pre-phase schema matches what the record describes.
 * @param options - Execution options
 * @param migration - Migration whose run failed
 * @param cause - The run's failure
 * @param notify - Reports the record that could not be cleared
 * @returns The error to raise instead when the record may remain
 */
async function releaseMigrationInProgress(
  options: MigrationExecutionOptions,
  migration: PendingMigration,
  cause: unknown,
  notify: (level: "warn", message: string) => void,
): Promise<Error | undefined> {
  try {
    await clearMigrationInProgress(options.client, options.workspaceId, migration.namespace);
    return undefined;
  } catch (error) {
    let state: RemoteMigrationState;
    try {
      state = await fetchRemoteMigrationState(
        options.client,
        resourceTrn(options.workspaceId, "tailordb", migration.namespace),
      );
    } catch {
      return unreleasedRecordError(migration, cause, false);
    }
    if (!state.inProgressInvalid && state.inProgress?.number !== migration.number) {
      return undefined;
    }
    notify(
      "warn",
      `Could not clear the in-progress record of migration ${migration.namespace}/${formatMigrationNumber(migration.number)}: ` +
        `${error instanceof Error ? error.message : String(error)}.`,
    );
    return unreleasedRecordError(migration, cause, true);
  }
}

/**
 * Execute a multi-step migration, recording it as in progress until its
 * checkpoint is committed.
 * @param options - Execution options
 * @param migration - Migration to execute
 * @param form - The script's validated steps
 * @param inProgress - What an earlier deploy recorded for this migration, if anything
 * @param sp - Spinner showing step progress
 * @param display - Receives the run's progress
 * @returns Execution result
 */
async function executeStepsMigration(
  options: MigrationExecutionOptions,
  migration: PendingMigration,
  form: Extract<MigrationScriptForm, { kind: "steps" }>,
  inProgress: MigrationInProgress | undefined,
  sp: Spinner,
  display: MigrationRunDisplay,
): Promise<ExecutionResult> {
  const { client, workspaceId, invoker, env, configDir, appName, appId } = options;
  const bundleResult = await bundleMigrationSteps({
    sourceFile: migration.scriptPath,
    namespace: migration.namespace,
    migrationNumber: migration.number,
    env,
    baseDir: configDir,
    order: form.order,
    runnerJobFunctionName: migrationStepRunnerName(
      migrationWorkflowResourceName(migration.namespace, migration.number),
    ),
    temporal: migration.diff.temporal ?? false,
    dateDefault: migration.diff.dateRepresentation ?? "legacy",
  });

  const notify = (level: "info" | "warn", message: string) => {
    sp.stop();
    logger[level](message);
    sp.start();
  };
  let mayBeRecorded = inProgress !== undefined;
  let started = inProgress !== undefined;
  let result: MigrationStepsWorkflowResult;
  try {
    result = await executeMigrationStepsAsWorkflow({
      client,
      workspaceId,
      code: bundleResult.bundledCode,
      namespace: migration.namespace,
      migrationNumber: migration.number,
      invoker,
      appName,
      appId,
      order: form.order,
      inProgress,
      notify,
      onBeforeStart: async () => {
        mayBeRecorded = true;
        await writeMigrationInProgress(client, workspaceId, migration.namespace, migration.number);
      },
      onExecutionStarted: async (executionId) => {
        started = true;
        await writeMigrationInProgress(
          client,
          workspaceId,
          migration.namespace,
          migration.number,
          executionId,
        );
      },
      onProgress: display.onProgress,
      onRunEvent: display.onRunEvent,
    });
  } catch (error) {
    if (isCLIError(error) && error.code === "MIGRATION_START_UNCONFIRMED") {
      throw unconfirmedStartError(migration, error);
    }
    const anotherRunActive = isCLIError(error) && error.code === "MIGRATION_EXECUTION_ACTIVE";
    if (started || anotherRunActive) {
      throw partiallyAppliedError(migration, { completedSteps: [], failedSteps: [] }, error);
    }
    const failure = mayBeRecorded
      ? await releaseMigrationInProgress(options, migration, error, notify)
      : undefined;
    throw failure ?? error;
  }

  if (result.success) {
    return {
      namespace: migration.namespace,
      migrationNumber: migration.number,
      success: true,
      logs: result.logs,
    };
  }
  const failed = {
    namespace: migration.namespace,
    migrationNumber: migration.number,
    success: false,
    logs: result.logs,
    error: result.error,
  };
  if (result.stepsMayHaveCommitted || inProgress) {
    return {
      ...failed,
      failure: partiallyAppliedError(migration, result, result.error ?? "Migration failed"),
    };
  }
  const failure = await releaseMigrationInProgress(
    options,
    migration,
    result.error ?? "Migration failed",
    notify,
  );
  return failure ? { ...failed, failure } : failed;
}

/**
 * Execute all pending migrations, grouping by namespace and using appropriate machine user
 * @param {MigrationContext} context - Migration context with per-namespace configuration
 * @param {PendingMigration[]} migrations - Migrations to execute
 * @param inProgressByNamespace - Migrations an earlier deploy left in progress, by namespace
 * @param timeline - Receives the phases of each migration run
 * @returns {Promise<void>}
 */
export async function executeMigrations(
  context: MigrationContext,
  migrations: PendingMigration[],
  inProgressByNamespace: Readonly<Record<string, MigrationInProgress>> = {},
  timeline?: MaintenanceTimeline,
): Promise<void> {
  // Run migrate.ts whenever the file exists on disk. Required for breaking changes,
  // optional for warning-tier changes (e.g. field_removed).
  const migrationsWithScripts = migrations.filter((m) => m.hasScript);

  if (migrationsWithScripts.length === 0) {
    return;
  }

  // Group migrations by namespace
  const migrationsByNamespace = groupMigrationsByNamespace(migrationsWithScripts);

  // Execute migrations for each namespace with appropriate machine user
  for (const [namespace, namespaceMigrations] of migrationsByNamespace) {
    const dbConfig = context.dbConfig[namespace];
    const migrationConfig = dbConfig?.migration;

    // Get machine user name for this namespace
    const machineUserName = getMigrationMachineUser(migrationConfig, context.machineUsers);
    if (!machineUserName) {
      throw CLIError({
        code: "MACHINE_USER_REQUIRED",
        message: `No machine user available for migration execution in namespace '${namespace}'.`,
        suggestion:
          "Either configure 'migration.machineUser' in db config or define machine users in auth config.",
      });
    }

    const invoker = create(AuthInvokerSchema, {
      namespace: context.authNamespace,
      machineUserName,
    });

    const options: MigrationExecutionOptions = {
      client: context.client,
      workspaceId: context.workspaceId,
      invoker,
      env: context.env,
      configDir: context.configDir,
      appName: context.appName,
      appId: context.appId,
    };

    logger.info(`Using machine user: ${styles.bold(machineUserName)} for namespace '${namespace}'`);

    for (const migration of namespaceMigrations) {
      const migrationLabel = `${migration.namespace}/${formatMigrationNumber(migration.number)}`;
      const timer = new ScriptRunTimer(migration.namespace, migration.number);
      const sp = spinner().start(`Executing migration ${migrationLabel}...`);

      const recorded = inProgressByNamespace[migration.namespace];
      let result: ExecutionResult;
      try {
        result = await executeSingleMigration(
          options,
          migration,
          recorded?.number === migration.number ? recorded : undefined,
          sp,
          displayMigrationRun(migrationLabel, timer, sp),
        );
      } catch (error) {
        sp.fail(`Migration ${migrationLabel} failed`);
        throw error;
      } finally {
        timeline?.recordScript(timer);
      }

      if (result.success) {
        const timing = timer.startObserved
          ? ` (waiting to start ${formatDuration(timer.waitedMs)}, running ${formatDuration(timer.ranMs)})`
          : "";
        sp.succeed(`Migration ${migrationLabel} completed successfully${timing}`);

        // Show logs if any
        if (result.logs && result.logs.trim()) {
          logger.log(`Logs:\n${result.logs}`);
        }
      } else {
        sp.fail(`Migration ${migrationLabel} failed`);
        if (result.logs) {
          logger.error(`Logs:\n${result.logs}`);
        }
        throw (
          result.failure ??
          CLIError({ code: "MIGRATION_FAILED", message: result.error ?? "Migration failed" })
        );
      }
    }
  }
}

/**
 * Get the machine user name for migration execution
 *
 * Priority:
 * 1. machineUser from migration config (if set)
 * 2. First machine user from auth config
 * @param {object | undefined} migrationConfig - Migration config for namespace
 * @param {string[] | undefined} machineUsers - Machine users from auth config
 * @returns {string | undefined} Machine user name or undefined if none available
 */
export function getMigrationMachineUser(
  migrationConfig: { machineUser?: string } | undefined,
  machineUsers: string[] | undefined,
): string | undefined {
  // Priority 1: Explicit config
  if (migrationConfig?.machineUser) {
    return migrationConfig.machineUser;
  }

  // Priority 2: First machine user from auth
  if (machineUsers && machineUsers.length > 0) {
    return machineUsers[0];
  }

  return undefined;
}

/**
 * Group migrations by namespace
 * @param {PendingMigration[]} migrations - Migrations to group
 * @returns {Map<string, PendingMigration[]>} Migrations grouped by namespace
 */
export function groupMigrationsByNamespace(
  migrations: PendingMigration[],
): Map<string, PendingMigration[]> {
  const grouped = new Map<string, PendingMigration[]>();
  for (const migration of migrations) {
    const existing = grouped.get(migration.namespace) ?? [];
    existing.push(migration);
    grouped.set(migration.namespace, existing);
  }
  return grouped;
}
