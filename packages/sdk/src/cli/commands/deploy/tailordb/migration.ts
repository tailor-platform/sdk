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
import { analyzeMigrationScript } from "#/cli/commands/tailordb/migrate/script-form";
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
import {
  executeMigrationAsWorkflow,
  executeMigrationStepsAsWorkflow,
  migrationStepRunnerName,
  migrationWorkflowResourceName,
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

      pendingMigrations.push({
        number: file.number,
        scriptPath,
        hasScript,
        scriptForm: hasScript ? analyzeMigrationScript(scriptPath) : null,
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

/**
 * Execute a single migration script
 * @param {MigrationExecutionOptions} options - Execution options
 * @param {PendingMigration} migration - Migration to execute
 * @param inProgress - What an earlier deploy recorded for this migration, if anything
 * @param sp - Spinner showing progress
 * @returns {Promise<ExecutionResult>} Execution result
 */
async function executeSingleMigration(
  options: MigrationExecutionOptions,
  migration: PendingMigration,
  inProgress: MigrationInProgress | undefined,
  sp: Spinner,
): Promise<ExecutionResult> {
  const { client, workspaceId, invoker, env, configDir, appName, appId } = options;
  if (migration.scriptForm?.kind === "steps") {
    return executeStepsMigration(options, migration, migration.scriptForm, inProgress, sp);
  }

  // Bundle the migration script
  const bundleResult = await bundleMigrationScript(
    migration.scriptPath,
    migration.namespace,
    migration.number,
    env,
    configDir,
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
 * @returns {Promise<void>}
 */
export async function updateMigrationLabel(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
  migrationNumber: number,
  historyId?: string,
): Promise<void> {
  const trn = resourceTrn(workspaceId, "tailordb", namespace);

  await writeMetadataLabelsDirect(client, {
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
      "Fix the failing step in migrate.ts and deploy again; steps that already completed do not run again. " +
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

/**
 * Execute a multi-step migration, recording it as in progress until its
 * checkpoint is committed.
 * @param options - Execution options
 * @param migration - Migration to execute
 * @param form - The script's validated steps
 * @param inProgress - What an earlier deploy recorded for this migration, if anything
 * @param sp - Spinner showing step progress
 * @returns Execution result
 */
async function executeStepsMigration(
  options: MigrationExecutionOptions,
  migration: PendingMigration,
  form: Extract<MigrationScriptForm, { kind: "steps" }>,
  inProgress: MigrationInProgress | undefined,
  sp: Spinner,
): Promise<ExecutionResult> {
  const { client, workspaceId, invoker, env, configDir, appName, appId } = options;
  const migrationLabel = `${migration.namespace}/${formatMigrationNumber(migration.number)}`;
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
  });

  if (!inProgress) {
    await writeMigrationInProgress(client, workspaceId, migration.namespace, migration.number);
  }
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
      ...(inProgress
        ? {
            inProgress: inProgress.executionId ? { executionId: inProgress.executionId } : {},
          }
        : {}),
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
      onProgress: (completed, total) => {
        sp.text = `Executing migration ${migrationLabel} (${completed}/${total} steps completed)...`;
      },
    });
  } catch (error) {
    if (started) {
      throw partiallyAppliedError(migration, { completedSteps: [], failedSteps: [] }, error);
    }
    await clearMigrationInProgress(client, workspaceId, migration.namespace);
    throw error;
  }

  if (result.success) {
    return {
      namespace: migration.namespace,
      migrationNumber: migration.number,
      success: true,
      logs: result.logs,
    };
  }
  if (result.stepsMayHaveCommitted || inProgress) {
    if (result.logs) logger.error(`Logs:\n${result.logs}`);
    throw partiallyAppliedError(migration, result, result.error ?? "Migration failed");
  }
  await clearMigrationInProgress(client, workspaceId, migration.namespace);
  return {
    namespace: migration.namespace,
    migrationNumber: migration.number,
    success: false,
    logs: result.logs,
    error: result.error,
  };
}

/**
 * Execute all pending migrations, grouping by namespace and using appropriate machine user
 * @param {MigrationContext} context - Migration context with per-namespace configuration
 * @param {PendingMigration[]} migrations - Migrations to execute
 * @param inProgressByNamespace - Migrations an earlier deploy left in progress, by namespace
 * @returns {Promise<void>}
 */
export async function executeMigrations(
  context: MigrationContext,
  migrations: PendingMigration[],
  inProgressByNamespace: Readonly<Record<string, MigrationInProgress>> = {},
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
      const sp = spinner().start(
        `Executing migration ${migrationLabel} (this can take a while)...`,
      );

      const recorded = inProgressByNamespace[migration.namespace];
      let result: ExecutionResult;
      try {
        result = await executeSingleMigration(
          options,
          migration,
          recorded?.number === migration.number ? recorded : undefined,
          sp,
        );
      } catch (error) {
        sp.fail(`Migration ${migrationLabel} failed`);
        throw error;
      }

      if (result.success) {
        sp.succeed(`Migration ${migrationLabel} completed successfully`);

        // Show logs if any
        if (result.logs && result.logs.trim()) {
          logger.log(`Logs:\n${result.logs}`);
        }
      } else {
        sp.fail(`Migration ${migrationLabel} failed`);
        if (result.logs) {
          logger.error(`Logs:\n${result.logs}`);
        }
        throw CLIError({ code: "MIGRATION_FAILED", message: result.error ?? "Migration failed" });
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
