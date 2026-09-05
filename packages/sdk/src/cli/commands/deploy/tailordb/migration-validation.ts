import * as path from "pathe";
import {
  getNamespacesWithMigrations,
  type NamespaceWithMigrations,
} from "#/cli/commands/tailordb/migrate/config";
import { captureMigrationFileState } from "#/cli/commands/tailordb/migrate/file-state";
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
};

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
        throw new Error("Schema migration check failed");
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
        throw new Error("Remote migration checkpoint verification failed");
      }
      const hasRemoteDrift = remoteVerificationResults.some((r) => r.hasDrift);

      if (hasRemoteDrift) {
        logger.error("Remote schema drift detected:");
        logger.log(formatRemoteVerificationResults(remoteVerificationResults));
        logger.newline();
        logRemoteDriftGuidance(remoteVerificationResults);
        logger.newline();
        logger.info("Use '--no-schema-check' to skip this check (not recommended).");
        throw new Error("Remote schema verification failed");
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
    pendingMigrations = await detectPendingMigrations(
      client,
      workspaceId,
      namespacesWithMigrations,
      config.path,
      currentMigrationOverrides,
    );

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
  };
}
