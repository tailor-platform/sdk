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
  bundleSingleStepMigration,
} from "#/cli/commands/tailordb/migrate/bundler";
import { type NamespaceWithMigrations } from "#/cli/commands/tailordb/migrate/config";
import { formatMigrationScriptHint } from "#/cli/commands/tailordb/migrate/hints";
import {
  describeMigrationCheckpoint,
  fetchRemoteMigrationState,
  formatMigrationResolveHint,
  isCheckpointStillOwned,
  type ExpectedMigrationCheckpoint,
  type RemoteMigrationState,
} from "#/cli/commands/tailordb/migrate/remote-state";
import {
  analyzeMigrationScript,
  countUnresolvedTodosInFile,
  ignoredStepsWarning,
  UNRESOLVED_TODO_SUGGESTION,
  usesStepRunner,
} from "#/cli/commands/tailordb/migrate/script-form";
import {
  loadDiff,
  getMigrationFiles,
  getMigrationFilePath,
  formatMigrationNumber,
} from "#/cli/commands/tailordb/migrate/snapshot";
import {
  type MigrationInProgress,
  type MigrationRunKind,
  type PendingMigration,
  executionIdToLabel,
  inProgressLabel,
  MAINTENANCE_MODE_LABEL_KEY,
  MIGRATION_EXECUTION_LABEL_KEY,
  MIGRATION_HISTORY_LABEL_KEY,
  MIGRATION_IN_PROGRESS_LABEL_KEY,
  MIGRATION_LABEL_KEY,
  sanitizeMigrationLabel,
} from "#/cli/commands/tailordb/migrate/types";
import { type OperatorClient } from "#/cli/shared/client";
import { getErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { CLIError, isCLIError } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { protoEnumName } from "#/cli/shared/proto-enum";
import { spinner } from "#/cli/shared/spinner";
import { assertDefined } from "#/utils/assert";
import { resourceTrn, writeMetadataLabelsDirect } from "../label";
import { formatDuration, ScriptRunTimer, type MaintenanceTimeline } from "./migration-timing";
import {
  executeMigrationAsWorkflow,
  executeMigrationStepsAsWorkflow,
  migrationStepRunnerName,
  migrationWorkflowResourceName,
  removeMigrationWorkflowResources,
  type LongRunningMigrationResult,
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
  maintenanceMode: boolean;
  skipSteps?: ReadonlyMap<string, readonly string[]>;
  /** Checkpoint each namespace must still have when one of its migrations starts running. */
  checkpoints: ReadonlyMap<string, ExpectedMigrationCheckpoint>;
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
  /** Whether the migrating namespaces are in maintenance mode. */
  maintenanceMode: boolean;
  /** Steps of an in-progress multi-step migration to skip, keyed by namespace. */
  skipSteps?: ReadonlyMap<string, readonly string[]>;
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

      if (hasScript && countUnresolvedTodosInFile(scriptPath) > 0) {
        throw CLIError({
          code: "MIGRATION_SCRIPT_REVIEW_REQUIRED",
          message: `Migration ${namespace}/${formatMigrationNumber(file.number)} still has a TODO() call or review marker in migrate.ts, where the generated script leaves a value or logic for you to decide.`,
          suggestion: UNRESOLVED_TODO_SUGGESTION,
        });
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
    return `${name}=${protoEnumName(WorkflowJobExecution_Status, job.status) ?? job.status}`;
  });
  const status = protoEnumName(WorkflowExecution_Status, execution.status) ?? execution.status;
  return `workflow execution ${status}, ${jobs.length > 0 ? `jobs ${jobs.join(", ")}` : "no jobs yet"}`;
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
    const progress = `(${steps}${formatDuration(at - timer.phaseStartedAt)})`;
    sp.text =
      timer.phase === "running"
        ? `Running migration ${migrationLabel} ${progress}...`
        : timer.phase === "waitingOrRunning"
          ? `Executing migration ${migrationLabel} ${progress}...`
          : `Waiting for a job of migration ${migrationLabel} to start ${progress}...`;
  };
  return {
    onRunEvent: (event) => {
      if (event.type === "finished") {
        timer.finished(event.at, event.scriptStarted);
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
      if (event.type === "unknown") timer.unknown(event.at);
      render(event.at);
      if (event.type === "unknown") {
        debug(`Migration ${migrationLabel}: could not tell whether its script is running.`);
      }
      if (firstStart) {
        aside(() =>
          logger.info(
            `Migration ${migrationLabel} started running after waiting ${formatDuration(timer.waitedMs)} for its job to start.`,
            { mode: "stream" },
          ),
        );
      }
      if (event.type === "polled" && logger.verbose) {
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
  const form = migration.scriptForm;
  if (form?.kind === "steps" && usesStepRunner(form, inProgress !== undefined)) {
    return executeStepsMigration(options, migration, form, inProgress, sp, display);
  }

  // Bundle the migration script
  const temporal = migration.diff.temporal ?? false;
  const dateDefault = migration.diff.dateRepresentation ?? "legacy";
  const bundleResult =
    form?.kind === "steps"
      ? await bundleSingleStepMigration({
          sourceFile: migration.scriptPath,
          namespace: migration.namespace,
          migrationNumber: migration.number,
          env,
          baseDir: configDir,
          step: assertDefined(form.order[0], "a steps script has at least one step"),
          temporal,
          dateDefault,
        })
      : await bundleMigrationScript(
          migration.scriptPath,
          migration.namespace,
          migration.number,
          env,
          configDir,
          temporal,
          dateDefault,
        );

  const notify = notifyAround(sp);
  const recording = { mayBeRecorded: false };
  let result: LongRunningMigrationResult;
  try {
    result = await executeMigrationAsWorkflow({
      client,
      workspaceId,
      code: bundleResult.bundledCode,
      namespace: migration.namespace,
      migrationNumber: migration.number,
      invoker,
      appName,
      appId,
      maintenanceMode: options.maintenanceMode,
      onBeforeStart: async () => {
        await assertCheckpointUnchanged(options, migration);
        recording.mayBeRecorded = true;
        await writeMigrationInProgress(client, workspaceId, migration.namespace, {
          number: migration.number,
          kind: "main",
        });
      },
      onExecutionStarted: (executionId) =>
        writeMigrationInProgress(client, workspaceId, migration.namespace, {
          number: migration.number,
          executionId,
          kind: "main",
        }),
      onRunEvent: display.onRunEvent,
    });
  } catch (error) {
    const failure =
      recording.mayBeRecorded && !isMigrationOutcomeUnknown(error)
        ? await releaseMigrationInProgress(options, migration, error, notify, "main")
        : undefined;
    throw failure ?? error;
  }

  const executed = {
    namespace: migration.namespace,
    migrationNumber: migration.number,
    success: result.success,
    logs: result.logs,
    error: result.error,
  };
  if (result.success) return executed;
  const failure = recording.mayBeRecorded
    ? await releaseMigrationInProgress(
        options,
        migration,
        result.error ?? "Migration failed",
        notify,
        "main",
      )
    : undefined;
  if (failure) return { ...executed, failure };
  await removeRunResources(client, workspaceId, migration.namespace, migration.number);
  return executed;
}

/**
 * Report a notice while a spinner runs, pausing the spinner around it.
 * @param sp - Spinner showing the migration's progress
 * @returns Reports a notice, with what to do about it below when there is something to do
 */
function notifyAround(sp: Spinner) {
  return (level: "info" | "warn", message: string, suggestion?: string) => {
    sp.stop();
    logger[level](message);
    if (suggestion) logger.log(suggestion);
    sp.start();
  };
}

/**
 * Remove the temporary resources of a migration's run, warning instead of failing when they
 * cannot be removed.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param namespace - TailorDB namespace
 * @param migrationNumber - Migration whose run's resources are removed
 */
export async function removeRunResources(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
  migrationNumber: number,
): Promise<void> {
  try {
    await removeMigrationWorkflowResources(client, workspaceId, namespace, migrationNumber);
  } catch (error) {
    logger.warn(
      `Could not remove the temporary resources of migration ${namespace}/${formatMigrationNumber(migrationNumber)}: ` +
        `${error instanceof Error ? error.message : String(error)}. A later deploy removes them.`,
    );
  }
}

/**
 * Update the migration label on TailorDB Service metadata
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {string} namespace - TailorDB namespace
 * @param {number} migrationNumber - Migration number to set
 * @param historyId - Optional migration history ID to set atomically with the checkpoint
 * @param recordMaintenanceMode - Whether to record, atomically with the checkpoint, that the namespace's tables are still in maintenance mode
 * @returns Whether the labels changed
 */
export async function updateMigrationLabel(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
  migrationNumber: number,
  historyId?: string,
  recordMaintenanceMode = false,
): Promise<boolean> {
  const trn = resourceTrn(workspaceId, "tailordb", namespace);

  return writeMetadataLabelsDirect(client, {
    trn,
    labels: {
      [MIGRATION_LABEL_KEY]: sanitizeMigrationLabel(migrationNumber),
      ...(historyId ? { [MIGRATION_HISTORY_LABEL_KEY]: historyId } : {}),
      ...(recordMaintenanceMode
        ? { [MAINTENANCE_MODE_LABEL_KEY]: sanitizeMigrationLabel(migrationNumber) }
        : {}),
    },
    remove: [
      ...(historyId ? [] : [MIGRATION_HISTORY_LABEL_KEY]),
      MIGRATION_IN_PROGRESS_LABEL_KEY,
      MIGRATION_EXECUTION_LABEL_KEY,
    ],
  });
}

/**
 * Refuse to start a migration's run once its namespace no longer has the checkpoint this deploy
 * expects, since a record of the run would then not follow the checkpoint.
 * @param options - Execution options
 * @param migration - Migration about to start
 */
async function assertCheckpointUnchanged(
  options: MigrationExecutionOptions,
  migration: PendingMigration,
): Promise<void> {
  const expected = assertDefined(
    options.checkpoints.get(migration.namespace),
    "every namespace with a migration to run has an expected checkpoint",
  );
  const { namespace } = migration;
  let remoteState: RemoteMigrationState;
  try {
    remoteState = await fetchRemoteMigrationState(
      options.client,
      resourceTrn(options.workspaceId, "tailordb", namespace),
    );
  } catch (error) {
    throw CLIError({
      code: "MIGRATION_CHECKPOINT_UNVERIFIED",
      message:
        `Could not confirm migration checkpoint ${namespace}/${describeMigrationCheckpoint(expected.number)} before migration ${namespace}/${formatMigrationNumber(migration.number)} started: ` +
        (error instanceof Error ? error.message : String(error)),
      suggestion: "Deploy again.",
      cause: error,
    });
  }
  if (isCheckpointStillOwned(remoteState, expected)) return;
  const history = remoteState.historyIdInvalid
    ? " with a migration history label that cannot be read"
    : remoteState.historyId === expected.historyId
      ? ""
      : " in a different migration history";
  throw CLIError({
    code: "MIGRATION_CHECKPOINT_CONFLICT",
    message: `Migration checkpoint ${namespace}/${describeMigrationCheckpoint(expected.number)} changed to ${describeMigrationCheckpoint(remoteState.number)}${history} before migration ${namespace}/${formatMigrationNumber(migration.number)} started.`,
    suggestion:
      "Another deploy or 'tailor tailordb migration set' changed it while this deploy ran. " +
      `Run 'tailor tailordb migration status --namespace ${namespace}' to see it. ` +
      "If another deploy is running, wait for it to finish; otherwise return the namespace to the checkpoint with " +
      `'tailor tailordb migration sync ${formatMigrationNumber(expected.number ?? 0)} --namespace ${namespace}'. Then deploy again.`,
    context: {
      namespace,
      migrationNumber: migration.number,
      expectedCheckpoint: expected.number,
      remoteCheckpoint: remoteState.number,
      expectedHistoryId: expected.historyId,
      remoteHistoryId: remoteState.historyId,
    },
  });
}

/**
 * Record that a migration's script is running, so a deploy that stops or fails
 * after a step committed leaves the next deploy able to resume it, and one that
 * loses track of a `main` run leaves the run to be settled.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param namespace - TailorDB namespace
 * @param record - The migration being applied, and the execution running it once started
 */
async function writeMigrationInProgress(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
  record: MigrationInProgress,
): Promise<void> {
  const { executionId } = record;
  await writeMetadataLabelsDirect(client, {
    trn: resourceTrn(workspaceId, "tailordb", namespace),
    labels: {
      [MIGRATION_IN_PROGRESS_LABEL_KEY]: inProgressLabel(record.number, record.kind),
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
 * Remove the record of a maintenance mode that has been lifted.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param namespace - TailorDB namespace
 */
export async function clearMaintenanceModeRecord(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
): Promise<void> {
  await writeMetadataLabelsDirect(client, {
    trn: resourceTrn(workspaceId, "tailordb", namespace),
    labels: {},
    remove: [MAINTENANCE_MODE_LABEL_KEY],
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

/**
 * Whether a migration run's outcome is unknown, so its schema changes must
 * stay in place until the user settles the migration.
 * @param error - Failure raised while executing migrations
 * @returns True for a run whose outcome is unknown
 */
export function isMigrationOutcomeUnknown(error: unknown): boolean {
  return isCLIError(error) && error.code === "MIGRATION_OUTCOME_UNKNOWN";
}

/**
 * Whether a migration's run was refused before it started because its namespace's checkpoint
 * changed or could not be confirmed, so the failure is not the script's.
 * @param error - Failure raised while executing migrations
 * @returns True for a run refused before it started
 */
export function isMigrationStartRefused(error: unknown): boolean {
  return (
    isCLIError(error) &&
    (error.code === "MIGRATION_CHECKPOINT_CONFLICT" ||
      error.code === "MIGRATION_CHECKPOINT_UNVERIFIED")
  );
}

/**
 * Whether a partially applied migration's run was observed in a final state, so
 * rolling back its schema cannot race a step that is still writing.
 * @param error - Failure raised while executing migrations
 * @returns True when the run ended
 */
export function isMigrationRunEnded(error: unknown): boolean {
  return (
    isCLIError(error) &&
    error.code === "MIGRATION_PARTIALLY_APPLIED" &&
    error.context?.runEnded === true
  );
}

function withMaintenanceModeNote(
  suggestion: string | undefined,
  namespace: string,
  maintenanceMode: boolean,
  until = "Until the migration completes",
): string | undefined {
  if (!maintenanceMode) return suggestion;
  const note = `${until}, the tables of namespace '${namespace}' stay in maintenance mode, as during the migration.`;
  return suggestion ? `${suggestion} ${note}` : note;
}

function partiallyAppliedError(
  migration: PendingMigration,
  result: Pick<
    MigrationStepsWorkflowResult,
    "completedSteps" | "failedSteps" | "executionId" | "runEnded"
  >,
  cause: unknown,
  maintenanceMode: boolean,
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
    suggestion: withMaintenanceModeNote(
      isCLIError(cause) && cause.suggestion
        ? cause.suggestion
        : "Fix the failing step in migrate.ts and deploy again; steps that already completed do not run again.",
      migration.namespace,
      maintenanceMode,
    ),
    context: {
      namespace: migration.namespace,
      migrationNumber: migration.number,
      completedSteps: result.completedSteps,
      failedSteps: result.failedSteps,
      ...(result.executionId ? { executionId: result.executionId } : {}),
      ...(result.runEnded ? { runEnded: true } : {}),
    },
    cause,
  });
}

/**
 * The failure of a migration that asked to be rolled back and was.
 * @param migration - Migration whose schema changes were rolled back
 * @param cause - The failure that triggered the rollback
 * @returns The error to raise in place of the original failure
 */
export function rolledBackError(migration: PendingMigration, cause: unknown): Error {
  const { namespace } = migration;
  const checkpoint = formatMigrationNumber(migration.number - 1);
  const causeHint =
    cause instanceof Error && !isCLIError(cause)
      ? getErrorDiagnostics(cause).suggestion
      : undefined;
  return CLIError({
    code: "MIGRATION_ROLLED_BACK",
    message: cause instanceof Error ? cause.message : String(cause),
    suggestion:
      `Migration ${namespace}/${formatMigrationNumber(migration.number)} was rolled back to migration ${checkpoint} and is no longer in progress; ` +
      "any table the rollback could not revert is listed in a warning above. " +
      "Fix the failure in migrate.ts and deploy again: the next deploy runs every step again from the beginning." +
      (causeHint ? ` ${causeHint}` : ""),
    context: { namespace, migrationNumber: migration.number },
    cause,
  });
}

/** An in-progress record a failed migration could not clear. */
export interface RemainingRecord {
  /** Whether the remote state confirmed the migration's own record remains. */
  confirmed: boolean;
  /** How the record's run executes the script; a deploy does not resume a `main` run. */
  kind: MigrationRunKind;
}

/**
 * The failure of a migration that is rolled back on failure but whose in-progress
 * record could not be cleared, so its schema was left as it is.
 * @param migration - Migration that stays in progress
 * @param cause - The failure that triggered the rollback
 * @param maintenanceMode - Whether the namespace's tables stay in maintenance mode
 * @param record - The record that remains; a `main` one is of a run that succeeded
 * @returns The error to raise in place of the original failure
 */
export function rollbackSkippedError(
  migration: PendingMigration,
  cause: unknown,
  maintenanceMode: boolean,
  record: RemainingRecord,
): Error {
  const { namespace } = migration;
  const next =
    record.kind === "main"
      ? "Its in-progress record could not be cleared, so its schema was not rolled back, and deploys stop before changing anything until the migration is settled. " +
        `Once the data meets the migration's schema, run ${formatMigrationResolveHint("complete", namespace)} to keep what its script wrote; ` +
        `or run ${formatMigrationResolveHint("rollback", namespace)} to return to migration ${formatMigrationNumber(migration.number - 1)}.`
      : "Its in-progress record could not be cleared, so its schema was not rolled back and the migration stays in progress. " +
        `Deploy again to resume it, or run ${formatMigrationResolveHint("rollback", namespace)} to roll it back without deploying.`;
  return CLIError({
    code: "MIGRATION_PARTIALLY_APPLIED",
    message: cause instanceof Error ? cause.message : String(cause),
    suggestion: withMaintenanceModeNote(next, namespace, maintenanceMode, "Until then"),
    context: {
      namespace,
      migrationNumber: migration.number,
      rollbackSkipped: true,
      ...(record.confirmed ? { recordConfirmed: true } : {}),
    },
    cause,
  });
}

/**
 * Whether a rollback was skipped because the migration's own in-progress record was confirmed to
 * remain, so the migration resumes from the schema its Pre-phase left.
 * @param error - Failure raised while rolling back
 * @returns True when the rollback was skipped with the record confirmed
 */
export function isRollbackSkippedWithRecord(error: unknown): boolean {
  return (
    isCLIError(error) &&
    error.code === "MIGRATION_PARTIALLY_APPLIED" &&
    error.context?.rollbackSkipped === true &&
    error.context.recordConfirmed === true
  );
}

function unreleasedRecordError(
  migration: PendingMigration,
  cause: unknown,
  record: RemainingRecord,
  maintenanceMode: boolean,
): Error {
  const { namespace } = migration;
  const number = formatMigrationNumber(migration.number);
  const checkpoint = formatMigrationNumber(migration.number - 1);
  const resolveRollback = formatMigrationResolveHint("rollback", namespace);
  const next = !record.confirmed
    ? `Whether it is still recorded as in progress could not be confirmed, so its pre-migration schema stays in place. ` +
      `Run 'tailor tailordb migration status --namespace ${namespace}': if it reports migration ${number} in progress, ` +
      (record.kind === "main"
        ? `run ${resolveRollback} to clear the record, then fix the failure and deploy again; `
        : `fix the failure and deploy again, or run ${resolveRollback} to clear the record without deploying; `) +
      `otherwise run 'tailor tailordb migration sync ${checkpoint} --namespace ${namespace}' to return the schema to migration ${checkpoint}, then deploy again.`
    : record.kind === "main"
      ? "Its in-progress record could not be cleared, so its pre-migration schema stays in place, and deploys stop before changing anything until the record is cleared. " +
        `Run ${resolveRollback} to clear it, then fix the failure and deploy again.`
      : "Its in-progress record could not be cleared, so its pre-migration schema stays in place and the next deploy runs every step again. " +
        `Fix the failure and deploy again, or run ${resolveRollback} to clear the record without deploying.`;
  const reason = cause instanceof Error ? cause.message : String(cause);
  return CLIError({
    code: "MIGRATION_PARTIALLY_APPLIED",
    message:
      record.kind === "main"
        ? `Migration ${namespace}/${number} failed: ${reason}`
        : `Migration ${namespace}/${number} failed before any step completed: ${reason}`,
    suggestion: withMaintenanceModeNote(next, namespace, maintenanceMode, "Until then"),
    context: {
      namespace,
      migrationNumber: migration.number,
      ...(record.kind === "main" ? {} : { completedSteps: [], failedSteps: [] }),
    },
    cause,
  });
}

function unconfirmedStartError(
  migration: PendingMigration,
  cause: CLIError,
  maintenanceMode: boolean,
): Error {
  return CLIError({
    code: "MIGRATION_PARTIALLY_APPLIED",
    message: cause.message,
    suggestion: withMaintenanceModeNote(cause.suggestion, migration.namespace, maintenanceMode),
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
 * Clear the in-progress record of a migration whose script wrote nothing that
 * stays: no step committed, or a `main` run failed. When the record may remain,
 * the migration stays in progress so the Pre-phase schema matches what the
 * record describes.
 * @param options - Execution options
 * @param migration - Migration whose run failed
 * @param cause - The run's failure
 * @param notify - Reports the record that could not be cleared
 * @param kind - How the run executes the script
 * @returns The error to raise instead when the record may remain
 */
async function releaseMigrationInProgress(
  options: MigrationExecutionOptions,
  migration: PendingMigration,
  cause: unknown,
  notify: (level: "warn", message: string) => void,
  kind: MigrationRunKind,
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
      return unreleasedRecordError(
        migration,
        cause,
        { confirmed: false, kind },
        options.maintenanceMode,
      );
    }
    if (!state.inProgressInvalid && state.inProgress?.number !== migration.number) {
      return undefined;
    }
    notify(
      "warn",
      `Could not clear the in-progress record of migration ${migration.namespace}/${formatMigrationNumber(migration.number)}: ` +
        `${error instanceof Error ? error.message : String(error)}.`,
    );
    return unreleasedRecordError(
      migration,
      cause,
      { confirmed: true, kind },
      options.maintenanceMode,
    );
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
  const skipSteps = (inProgress && options.skipSteps?.get(migration.namespace)) || [];
  const bundleResult = await bundleMigrationSteps({
    sourceFile: migration.scriptPath,
    namespace: migration.namespace,
    migrationNumber: migration.number,
    env,
    baseDir: configDir,
    order: form.order,
    skipSteps,
    runnerJobFunctionName: migrationStepRunnerName(
      migrationWorkflowResourceName(migration.namespace, migration.number),
    ),
    temporal: migration.diff.temporal ?? false,
    dateDefault: migration.diff.dateRepresentation ?? "legacy",
  });

  const notify = notifyAround(sp);
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
      maintenanceMode: options.maintenanceMode,
      order: form.order,
      skipSteps,
      inProgress,
      notify,
      onBeforeStart: async () => {
        await assertCheckpointUnchanged(options, migration);
        mayBeRecorded = true;
        await writeMigrationInProgress(client, workspaceId, migration.namespace, {
          number: migration.number,
          kind: "steps",
        });
      },
      onExecutionStarted: async (executionId) => {
        started = true;
        await writeMigrationInProgress(client, workspaceId, migration.namespace, {
          number: migration.number,
          executionId,
          kind: "steps",
        });
      },
      onProgress: display.onProgress,
      onRunEvent: display.onRunEvent,
    });
  } catch (error) {
    if (isCLIError(error) && error.code === "MIGRATION_START_UNCONFIRMED") {
      throw unconfirmedStartError(migration, error, options.maintenanceMode);
    }
    if (isMigrationStartRefused(error)) throw error;
    const anotherRunActive = isCLIError(error) && error.code === "MIGRATION_EXECUTION_ACTIVE";
    if (started || anotherRunActive) {
      throw partiallyAppliedError(
        migration,
        { completedSteps: [], failedSteps: [] },
        error,
        options.maintenanceMode,
      );
    }
    const failure = mayBeRecorded
      ? await releaseMigrationInProgress(options, migration, error, notify, "steps")
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
      failure: partiallyAppliedError(
        migration,
        result,
        result.error ?? "Migration failed",
        options.maintenanceMode,
      ),
    };
  }
  const failure = await releaseMigrationInProgress(
    options,
    migration,
    result.error ?? "Migration failed",
    notify,
    "steps",
  );
  return failure ? { ...failed, failure } : failed;
}

/**
 * Execute all pending migrations, grouping by namespace and using appropriate machine user
 * @param {MigrationContext} context - Migration context with per-namespace configuration
 * @param {PendingMigration[]} migrations - Migrations to execute
 * @param checkpoints - Checkpoint each namespace must still have when its migration starts running
 * @param inProgressByNamespace - Migrations an earlier deploy left in progress, by namespace
 * @param timeline - Receives the phases of each migration run
 * @returns {Promise<void>}
 */
export async function executeMigrations(
  context: MigrationContext,
  migrations: PendingMigration[],
  checkpoints: ReadonlyMap<string, ExpectedMigrationCheckpoint>,
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
      maintenanceMode: context.maintenanceMode,
      skipSteps: context.skipSteps,
      checkpoints,
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
        sp.fail(
          isMigrationOutcomeUnknown(error)
            ? `Could not confirm the outcome of migration ${migrationLabel}`
            : isMigrationStartRefused(error)
              ? `Migration ${migrationLabel} did not start`
              : `Migration ${migrationLabel} failed`,
        );
        throw error;
      } finally {
        sp.stop();
        timeline?.recordScript(timer);
      }

      if (result.success) {
        const timing = [
          ...(timer.startObserved
            ? [
                `waiting to start ${formatDuration(timer.waitedMs)}`,
                `running ${formatDuration(timer.ranMs)}`,
              ]
            : []),
          ...(timer.unobservedMs > 0
            ? [`waiting to start or running ${formatDuration(timer.unobservedMs)}`]
            : []),
        ].join(", ");
        sp.succeed(
          `Migration ${migrationLabel} completed successfully${timing ? ` (${timing})` : ""}`,
        );

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
