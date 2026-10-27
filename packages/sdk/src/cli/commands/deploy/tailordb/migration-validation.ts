import * as path from "pathe";
import {
  getNamespacesWithMigrations,
  type NamespaceWithMigrations,
} from "#/cli/commands/tailordb/migrate/config";
import { captureMigrationFileState } from "#/cli/commands/tailordb/migrate/file-state";
import {
  describeMainRunSettlement,
  formatMigrationResolveHint,
  isStaleMigrationInProgress,
  migrationResolveArgs,
  type ExpectedMigrationCheckpoint,
  type RemoteMigrationState,
} from "#/cli/commands/tailordb/migrate/remote-state";
import {
  checkMigrationDiffs,
  formatMigrationCheckResults,
  formatRemoteVerificationResults,
  logMissingCheckpointGuidance,
  logRemoteDriftGuidance,
  verifyRemoteSchema,
  type TailorDBDeployInput,
} from "#/cli/commands/tailordb/migrate/schema-checks";
import {
  reconstructSnapshotFromMigrations,
  assertValidMigrationFiles,
  formatMigrationNumber,
  type TailorDBSnapshotType,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { detectPendingMigrations } from "./migration";
import {
  migrationWorkflowResourceName,
  readMigrationRunStatus,
  settlingResolution,
  type MigrationRunStatus,
} from "./migration-workflow";
import type {
  MigrationCheckpointRepair,
  MigrationInProgress,
  PendingMigration,
} from "#/cli/commands/tailordb/migrate/types";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";

export type ValidateAndDetectResult = {
  pendingMigrations: PendingMigration[];
  checkpointRepairs: MigrationCheckpointRepair[];
  namespacesWithMigrations: NamespaceWithMigrations[];
  migrationFileState: Record<string, string>;
  migrationHistoryIds: Record<string, string | null>;
  /** Checkpoint each namespace had when validated, or is confirmed to be repaired to, by namespace. */
  checkpoints: ReadonlyMap<string, ExpectedMigrationCheckpoint>;
  /** Migrations an earlier deploy left partially applied, by namespace. */
  inProgressMigrations: Record<string, MigrationInProgress>;
  /** In-progress records naming a migration whose checkpoint is already committed. */
  staleInProgress: StaleMigrationInProgress[];
  /** Checkpoint named by each namespace's record of a maintenance mode a deploy has not lifted. */
  maintenanceModeCheckpoints: Record<string, number>;
};

interface StaleMigrationInProgress {
  namespace: string;
  migrationNumber: number;
}

interface InProgressValidation {
  inProgressMigrations: Record<string, MigrationInProgress>;
  staleInProgress: StaleMigrationInProgress[];
}

export function migrationFileStatesEqual(
  planned: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
): boolean {
  const plannedNamespaces = Object.keys(planned).toSorted();
  const currentNamespaces = Object.keys(current).toSorted();
  return (
    plannedNamespaces.length === currentNamespaces.length &&
    plannedNamespaces.every(
      (namespace, index) =>
        namespace === currentNamespaces[index] && planned[namespace] === current[namespace],
    )
  );
}

const RUN_STATUS_DESCRIPTIONS: Record<MigrationRunStatus, string> = {
  running: "its run is still running",
  succeeded: "its run succeeded",
  failed: "its run failed",
  canceled: "its run was canceled",
  not_started: "its run did not start",
  unknown: "whether its run succeeded could not be confirmed",
};

/**
 * Refuse to deploy while a namespace records a `main` run that is not settled, naming the way to
 * settle it that fits how the run stands. Run before reporting the schema the run left as drift,
 * whose remedies the record refuses.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param namespace - TailorDB namespace
 * @param state - Checkpoint and in-progress record of the namespace
 */
async function assertMainRunSettled(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
  state: Pick<RemoteMigrationState, "number" | "inProgress">,
): Promise<void> {
  const record = state.inProgress;
  if (record?.kind !== "main" || isStaleMigrationInProgress(state)) return;
  const runStatus = await readMigrationRunStatus(client, workspaceId, namespace, record);
  const migrationLabel = `${namespace}/${formatMigrationNumber(record.number)}`;
  const workflowName = migrationWorkflowResourceName(namespace, record.number);
  const executionsHint = `'tailor workflow executions --workflow-name ${workflowName}'`;
  const resolution = settlingResolution(runStatus);
  const suggestion =
    resolution === "complete"
      ? `Run ${formatMigrationResolveHint(resolution, namespace)} to apply the migration's schema without running its script again, then deploy again.`
      : resolution === "rollback"
        ? `Run ${formatMigrationResolveHint(resolution, namespace)} to return to migration ${formatMigrationNumber(record.number - 1)}, then deploy again to run the migration again.`
        : runStatus === "running"
          ? `Wait until ${executionsHint} shows that the run finished, then deploy again to see how to settle it.`
          : `Check the run with ${executionsHint}. ${describeMainRunSettlement(namespace)}`;
  throw CLIError({
    code: "MIGRATION_OUTCOME_UNSETTLED",
    message: `An earlier deploy did not settle the run of migration ${migrationLabel}: ${RUN_STATUS_DESCRIPTIONS[runStatus]}.`,
    suggestion,
    ...(resolution
      ? { next: { command: "tailor", args: migrationResolveArgs(resolution, namespace) } }
      : {}),
    context: {
      namespace,
      migrationNumber: record.number,
      workflowName,
      ...(record.executionId ? { executionId: record.executionId } : {}),
      runStatus,
    },
  });
}

/**
 * Validate what earlier deploys recorded as in progress against the remote
 * checkpoint and the local migrations, so a deploy never resumes the wrong
 * migration nor runs a `main` script whose earlier run is not settled. Runs
 * even when schema checks are skipped.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param remoteStates - Remote migration state of each namespace whose checkpoint is not being repaired
 * @param repairedInProgress - Namespaces under checkpoint repair that also record a migration in progress
 * @param pendingMigrations - Pending migrations, sorted by namespace and number
 * @returns In-progress migrations to resume and stale records to clear
 */
async function validateMigrationsInProgress(
  client: OperatorClient,
  workspaceId: string,
  remoteStates: ReadonlyMap<string, RemoteMigrationState>,
  repairedInProgress: readonly string[],
  pendingMigrations: readonly PendingMigration[],
): Promise<InProgressValidation> {
  const repaired = repairedInProgress[0];
  if (repaired !== undefined) {
    throw CLIError({
      code: "MIGRATION_IN_PROGRESS_CONFLICT",
      message: `A migration is in progress in namespace "${repaired}", so its checkpoint cannot be repaired.`,
      suggestion:
        "From a checkout of the migration history that started the migration, finish a multi-step migration with a deploy, or settle the migration with 'tailor tailordb migration resolve' first.",
    });
  }

  const result: InProgressValidation = { inProgressMigrations: {}, staleInProgress: [] };
  for (const [namespace, state] of remoteStates) {
    if (state.inProgressInvalid) {
      throw CLIError({
        code: "MIGRATION_IN_PROGRESS_INVALID",
        message: `The in-progress migration recorded for namespace "${namespace}" cannot be read.`,
        suggestion:
          "The namespace metadata was edited outside the SDK. Restore the in-progress labels it recorded before deploying again.",
      });
    }
    const inProgress = state.inProgress;
    if (!inProgress) continue;
    const migrationLabel = `${namespace}/${formatMigrationNumber(inProgress.number)}`;
    if (isStaleMigrationInProgress(state)) {
      result.staleInProgress.push({ namespace, migrationNumber: inProgress.number });
      continue;
    }
    await assertMainRunSettled(client, workspaceId, namespace, state);
    const next = pendingMigrations.find((migration) => migration.namespace === namespace);
    if (next?.number !== inProgress.number) {
      throw CLIError({
        code: "MIGRATION_IN_PROGRESS_INVALID",
        message: `Migration ${migrationLabel} is in progress, but the next pending migration is ${
          next ? formatMigrationNumber(next.number) : "none"
        }.`,
        suggestion:
          "Deploy the migration history that started the migration and let it complete first.",
      });
    }
    if (next.scriptForm?.kind !== "steps") {
      throw CLIError({
        code: "MIGRATION_IN_PROGRESS_INVALID",
        message: `Migration ${migrationLabel} was partially applied by its steps, but its migrate.ts no longer exports \`steps\`.`,
        suggestion:
          "Keep the migration as `steps` so the deploy can finish it; steps that already completed do not run again.",
      });
    }
    result.inProgressMigrations[namespace] = inProgress;
  }
  return result;
}

/**
 * Validate migration files and detect pending migrations
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {ReadonlyMap<string, Record<string, TailorDBSnapshotType>>} typesByNamespace - Tables by namespace
 * @param {LoadedConfig} config - Loaded application config (includes path)
 * @param {boolean} noSchemaCheck - Whether to skip schema diff check
 * @param {ReadonlyArray<TailorDBDeployInput>} tailorDBInputs - Deploy inputs for namespace defaults
 * @returns {Promise<ValidateAndDetectResult>} Pending migrations and namespaces that have migration directories configured
 */
export async function validateAndDetectMigrations(
  client: OperatorClient,
  workspaceId: string,
  typesByNamespace: ReadonlyMap<string, Record<string, TailorDBSnapshotType>>,
  config: LoadedConfig,
  noSchemaCheck: boolean,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
): Promise<ValidateAndDetectResult> {
  const configDir = path.dirname(config.path);
  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);
  let pendingMigrations: PendingMigration[] = [];
  let checkpointRepairs: MigrationCheckpointRepair[] = [];
  let inProgress: InProgressValidation = { inProgressMigrations: {}, staleInProgress: [] };
  let repairedInProgress: string[] = [];
  const migrationHistoryIds = Object.create(null) as Record<string, string | null>;
  const checkpoints = new Map<string, ExpectedMigrationCheckpoint>();
  const maintenanceModeCheckpoints = Object.create(null) as Record<string, number>;

  if (namespacesWithMigrations.length > 0) {
    // Validate migration file integrity (sequential numbers, no gaps, no duplicates)
    for (const { namespace, migrationsDir } of namespacesWithMigrations) {
      assertValidMigrationFiles(migrationsDir, namespace);
      migrationHistoryIds[namespace] =
        reconstructSnapshotFromMigrations(migrationsDir)?.rebaseline?.historyId ?? null;
    }

    // Check for schema diffs if not skipped
    if (!noSchemaCheck) {
      // 1. Check local tables vs local snapshot (existing check)
      const migrationResults = await checkMigrationDiffs(
        typesByNamespace,
        namespacesWithMigrations,
      );
      const hasDiffs = migrationResults.some((r) => r.hasDiff);

      if (hasDiffs) {
        logger.error("Schema changes detected that are not in migration files:");
        logger.log(formatMigrationCheckResults(migrationResults));
        logger.newline();
        logger.info("Run 'tailor tailordb migration generate' to create migration files.");
        logger.info("Or use '--no-schema-check' to skip this check.");
        throw CLIError({
          code: "MIGRATION_SCHEMA_CHECK_FAILED",
          message: "Schema migration check failed",
          suggestion:
            "Run 'tailor tailordb migration generate' to create migration files, or use --no-schema-check to skip this check.",
        });
      }

      // 2. Check remote schema vs local snapshot (new check)
      const remoteVerificationResults = await verifyRemoteSchema(
        client,
        workspaceId,
        namespacesWithMigrations,
        config,
        tailorDBInputs,
      );
      checkpointRepairs = remoteVerificationResults.flatMap((result) =>
        result.checkpointRepair
          ? [{ namespace: result.namespace, ...result.checkpointRepair }]
          : [],
      );
      repairedInProgress = remoteVerificationResults
        .filter(
          (result) =>
            result.checkpointRepair &&
            (result.migrationInProgress || result.migrationInProgressInvalid),
        )
        .map((result) => result.namespace);
      const missingCheckpointResults = remoteVerificationResults.filter(
        (result) => result.checkpointMissingLocal,
      );
      if (missingCheckpointResults.length > 0) {
        logger.error("Remote migration checkpoint is not in the local migration history:");
        for (const result of missingCheckpointResults) {
          logger.log(
            `  ${result.namespace}: ${formatMigrationNumber(result.remoteMigrationNumber)}`,
          );
        }
        logger.newline();
        logMissingCheckpointGuidance(missingCheckpointResults);
        throw CLIError({
          code: "MIGRATION_CHECKPOINT_UNKNOWN",
          message: "Remote migration checkpoint verification failed",
        });
      }
      const hasRemoteDrift = remoteVerificationResults.some((r) => r.hasDrift);

      if (hasRemoteDrift) {
        for (const result of remoteVerificationResults) {
          await assertMainRunSettled(client, workspaceId, result.namespace, {
            number: result.remoteMigrationNumber,
            inProgress: result.migrationInProgress ?? null,
          });
        }
        logger.error("Remote schema drift detected:");
        logger.log(formatRemoteVerificationResults(remoteVerificationResults));
        logger.newline();
        logRemoteDriftGuidance(remoteVerificationResults);
        logger.newline();
        logger.info("Use '--no-schema-check' to skip this check (not recommended).");
        throw CLIError({
          code: "MIGRATION_REMOTE_DRIFT",
          message: "Remote schema verification failed",
        });
      }
      for (const repair of checkpointRepairs) {
        logger.warn(
          `Remote migration checkpoint for ${repair.namespace} will be reset to 0000 after confirmation (${formatMigrationNumber(repair.from)} → 0000); the remote schema already matches the local baseline.`,
        );
      }
    }

    // Detect pending migrations (migration scripts that haven't been executed yet)
    const currentMigrationOverrides = new Map(
      checkpointRepairs.map((repair) => [repair.namespace, repair.to]),
    );
    const remoteStates = new Map<string, RemoteMigrationState>();
    pendingMigrations = await detectPendingMigrations(
      client,
      workspaceId,
      namespacesWithMigrations,
      config.path,
      currentMigrationOverrides,
      remoteStates,
    );
    inProgress = await validateMigrationsInProgress(
      client,
      workspaceId,
      remoteStates,
      repairedInProgress,
      pendingMigrations,
    );
    for (const repair of checkpointRepairs) {
      checkpoints.set(repair.namespace, { number: repair.to, historyId: repair.toHistoryId });
    }
    for (const [namespace, state] of remoteStates) {
      checkpoints.set(namespace, {
        number: state.number,
        historyId: state.historyId,
        ...(state.historyIdInvalid && { historyIdInvalid: true }),
      });
      if (state.maintenanceModeCheckpoint === null) continue;
      maintenanceModeCheckpoints[namespace] = state.maintenanceModeCheckpoint;
    }

    if (pendingMigrations.length > 0) {
      logger.newline();

      // Classify migrations by whether a migrate.ts will run for them.
      const withScripts = pendingMigrations.filter((m) => m.hasScript);
      const withoutScripts = pendingMigrations.filter((m) => !m.hasScript);

      logger.info(`${pendingMigrations.length} pending migration(s) will be applied:`);
      if (withoutScripts.length > 0) {
        logger.info(
          `  • ${withoutScripts.length} schema change(s) (applied automatically with schema deployment)`,
          { mode: "plain" },
        );
      }
      if (withScripts.length > 0) {
        logger.info(
          `  • ${withScripts.length} data migration(s) (requires migration script execution)`,
          { mode: "plain" },
        );
      }
    }
  }

  return {
    pendingMigrations,
    checkpointRepairs,
    namespacesWithMigrations,
    migrationFileState: captureMigrationFileState(namespacesWithMigrations),
    migrationHistoryIds,
    checkpoints,
    ...inProgress,
    maintenanceModeCheckpoints,
  };
}
