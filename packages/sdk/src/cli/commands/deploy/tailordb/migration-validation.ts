import * as path from "pathe";
import {
  getNamespacesWithMigrations,
  type NamespaceWithMigrations,
} from "#/cli/commands/tailordb/migrate/config";
import { captureMigrationFileState } from "#/cli/commands/tailordb/migrate/file-state";
import {
  isStaleMigrationInProgress,
  type MigrationInProgress,
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
import type {
  MigrationCheckpointRepair,
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
  /** Migrations an earlier deploy left partially applied, by namespace. */
  inProgressMigrations: Record<string, MigrationInProgress>;
  /** In-progress records naming a migration whose checkpoint is already committed. */
  staleInProgress: StaleMigrationInProgress[];
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

/**
 * Validate what earlier deploys recorded as in progress against the remote
 * checkpoint and the local migrations, so a deploy never resumes the wrong
 * migration. Runs even when schema checks are skipped.
 * @param remoteStates - Remote migration state of each namespace whose checkpoint is not being repaired
 * @param repairedInProgress - Namespaces under checkpoint repair that also record a migration in progress
 * @param pendingMigrations - Pending migrations, sorted by namespace and number
 * @returns In-progress migrations to resume and stale records to clear
 */
function validateMigrationsInProgress(
  remoteStates: ReadonlyMap<string, RemoteMigrationState>,
  repairedInProgress: readonly string[],
  pendingMigrations: readonly PendingMigration[],
): InProgressValidation {
  const repaired = repairedInProgress[0];
  if (repaired !== undefined) {
    throw CLIError({
      code: "MIGRATION_IN_PROGRESS_CONFLICT",
      message: `A migration is in progress in namespace "${repaired}", so its checkpoint cannot be repaired.`,
      suggestion:
        "Deploy the migration history that started the migration and let it complete first.",
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
        .filter((result) => result.checkpointRepair && result.migrationInProgress)
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
    inProgress = validateMigrationsInProgress(remoteStates, repairedInProgress, pendingMigrations);

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
    ...inProgress,
  };
}

/**
 * Recommend maintenance mode when pending migrations will run without it
 * because the config leaves `maintenanceMode` unset.
 * @param config - Loaded application config
 * @param pendingMigrations - Migrations the deploy will apply
 */
export function warnUnsetMaintenanceMode(
  config: LoadedConfig,
  pendingMigrations: ReadonlyArray<PendingMigration>,
): void {
  if (config.maintenanceMode !== undefined || pendingMigrations.length === 0) return;
  const namespaces = [...new Set(pendingMigrations.map((migration) => migration.namespace))];
  logger.warn(
    `Tables in ${namespaces.length === 1 ? "namespace" : "namespaces"} ${namespaces.join(", ")} stay writable and keep publishing record events while the pending migrations run, ` +
      `because maintenanceMode is not set in ${path.basename(config.path)}. ` +
      `Set it to "migration" or "deploy" to restrict them, or to false to hide this warning.`,
  );
}
