import { type MessageInitShape } from "@bufbuild/protobuf";
import {
  type CreateTailorDBGQLPermissionRequestSchema,
  type CreateTailorDBServiceRequestSchema,
  type CreateTailorDBTypeRequestSchema,
  type DeleteTailorDBGQLPermissionRequestSchema,
  type DeleteTailorDBServiceRequestSchema,
  type DeleteTailorDBTypeRequestSchema,
  type UpdateTailorDBGQLPermissionRequestSchema,
  type UpdateTailorDBTypeRequestSchema,
} from "@tailor-platform/tailor-proto/tailordb_pb";
import { TailorDBTypeSchema } from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import * as path from "pathe";
import {
  getNamespacesWithMigrations,
  type NamespaceWithMigrations,
} from "#/cli/commands/tailordb/migrate/config";
import { captureMigrationFileState } from "#/cli/commands/tailordb/migrate/file-state";
import {
  applyPreMigrationFieldAdjustments,
  applyPreMigrationIndexAdjustments,
  buildPreMigrationChangesMap,
  buildPreMigrationIndexChangesMap,
} from "#/cli/commands/tailordb/migrate/pre-migration-schema";
import { fetchRemoteMigrationState } from "#/cli/commands/tailordb/migrate/remote-state";
import {
  checkMigrationDiffs,
  formatMigrationCheckResults,
  formatRemoteVerificationResults,
  logRemoteDriftGuidance,
  toTailorDBDeployInput,
  verifyRemoteSchema,
  type TailorDBDeployInput,
} from "#/cli/commands/tailordb/migrate/schema-checks";
import {
  reconstructSnapshotFromMigrations,
  assertValidMigrationFiles,
  formatMigrationNumber,
  getLatestMigrationNumber,
  getMigrationFiles,
  INITIAL_SCHEMA_NUMBER,
  type SchemaSnapshot,
  type TailorDBSnapshotType,
} from "#/cli/commands/tailordb/migrate/snapshot";
import {
  generateTailorDBTypeManifestFromSnapshot,
  protoGqlPermission,
} from "#/cli/commands/tailordb/migrate/snapshot-manifest";
import { handleOptionalToRequiredError } from "#/cli/commands/tailordb/migrate/types";
import { byName } from "#/cli/shared/apply-concurrency";
import { fetchAllTolerant, type OperatorClient } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { assertNoPublishEventsConflict, publishEventsConflict } from "#/cli/shared/publish-events";
import { createChangeSet, type HasName, type ChangeSet } from "../change-set";
import { areNormalizedEqual, normalizeProtoConfig, toComparableProtoJson } from "../compare";
import { ACTION_SYMBOLS, type DisplayAction, type GroupedDisplayEntry } from "../grouped-display";
import {
  addDependencyRecords,
  buildMetaRequest,
  type DependentAppsByResource,
  eventSourceKey,
  hasMatchingSdkVersion,
  type MetadataLabelWrite,
  resourceTrn,
  tailorDBTypeTrn,
  writeMetadataLabels,
} from "../label";
import {
  fetchExistingResourcesWithLabels,
  trackDesiredResourceOwnership,
  trackRemainingResourceOwner,
} from "../owned-resource";
import {
  executeMigrations,
  detectPendingMigrations,
  updateMigrationLabel,
  type MigrationContext,
} from "./migration";
import type {
  MigrationCheckpointRepair,
  PendingMigration,
} from "#/cli/commands/tailordb/migrate/types";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { TailorDBServiceConfig } from "#/types/tailordb.generated";
import type { OwnerConflict, UnmanagedResource } from "../confirm";
import type { ApplyPhase, PlanContext } from "../types";

// ============================================================================
// Migration Validation
// ============================================================================

type ValidateAndDetectResult = {
  pendingMigrations: PendingMigration[];
  checkpointRepairs: MigrationCheckpointRepair[];
  namespacesWithMigrations: NamespaceWithMigrations[];
  migrationFileState: Record<string, string>;
  migrationHistoryIds: Record<string, string | null>;
};

export { captureMigrationFileState } from "#/cli/commands/tailordb/migrate/file-state";

function migrationFileStatesEqual(
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
 * @param {ReadonlyMap<string, Record<string, TailorDBSnapshotType>>} typesByNamespace - Types by namespace
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
  const migrationHistoryIds: Record<string, string | null> = {};

  if (namespacesWithMigrations.length > 0) {
    // Validate migration file integrity (sequential numbers, no gaps, no duplicates)
    for (const { namespace, migrationsDir } of namespacesWithMigrations) {
      assertValidMigrationFiles(migrationsDir, namespace);
      migrationHistoryIds[namespace] =
        reconstructSnapshotFromMigrations(migrationsDir, INITIAL_SCHEMA_NUMBER)?.rebaseline
          ?.historyId ?? null;
    }

    // Check for schema diffs if not skipped
    if (!noSchemaCheck) {
      // 1. Check local types vs local snapshot (existing check)
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
        logger.info(
          "Pull the latest migration files, or run 'tailor tailordb migration status' to compare.",
        );
        throw new Error("Remote migration checkpoint verification failed");
      }
      const hasRemoteDrift = remoteVerificationResults.some((r) => r.hasDrift);

      if (hasRemoteDrift) {
        logger.error("Remote schema drift detected:");
        logger.log(formatRemoteVerificationResults(remoteVerificationResults));
        logger.newline();
        logRemoteDriftGuidance();
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

/**
 * Reconcile each namespace's migration checkpoint and history generation to
 * the working tree after a create-update apply.
 *
 * This records the initial baseline (`0000`), which is deployed via the normal
 * flow and never bumps the label itself, and keeps the label `<= working_tree_max`
 * after a `--no-schema-check` deploy from an older revision. Namespaces without a
 * baseline are skipped so no phantom label is written.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param namespacesWithMigrations - Namespaces that have migration directories configured
 * @param migrationHistoryIds - History generation captured during preflight for each namespace
 */
async function reconcileMigrationLabels(
  client: OperatorClient,
  workspaceId: string,
  namespacesWithMigrations: NamespaceWithMigrations[],
  migrationHistoryIds: Readonly<Record<string, string | null>>,
): Promise<void> {
  for (const { namespace, migrationsDir } of namespacesWithMigrations) {
    if (getMigrationFiles(migrationsDir).length === 0) {
      continue;
    }
    const targetVersion = getLatestMigrationNumber(migrationsDir);
    const historyId = migrationHistoryIds[namespace] ?? null;
    const remoteState = await fetchRemoteMigrationState(
      client,
      resourceTrn(workspaceId, "tailordb", namespace),
    ).catch(() => ({ number: null, historyId: null }));
    const currentVersion = remoteState.number;
    if (currentVersion === targetVersion && remoteState.historyId === historyId) {
      continue;
    }
    await updateMigrationLabel(
      client,
      workspaceId,
      namespace,
      targetVersion,
      historyId ?? undefined,
    );
    const from = currentVersion === null ? "<unset>" : formatMigrationNumber(currentVersion);
    logger.info(
      `Migration label for namespace ${namespace} reconciled: ${from} → ${formatMigrationNumber(targetVersion)}.`,
    );
  }
}

/**
 * Build migration execution context for script-based migrations.
 * @param client - Operator client instance
 * @param migrationContext - Planned TailorDB context
 * @param migrationsRequiringScripts - Migrations that require scripts
 * @returns Migration context for script execution
 */
function buildMigrationContextForScripts(
  client: OperatorClient,
  migrationContext: Awaited<ReturnType<typeof planTailorDB>>["context"],
  migrationsRequiringScripts: PendingMigration[],
): MigrationContext {
  const authService = migrationContext.application.authService;
  if (!authService) {
    throw new Error("Auth configuration is required to execute migration scripts.");
  }

  const dbConfigMap: Record<string, TailorDBServiceConfig | undefined> = {};
  for (const migration of migrationsRequiringScripts) {
    if (!(migration.namespace in dbConfigMap)) {
      dbConfigMap[migration.namespace] = migrationContext.config.db?.[migration.namespace] as
        | TailorDBServiceConfig
        | undefined;
    }
  }

  return {
    client,
    workspaceId: migrationContext.workspaceId,
    authNamespace: authService.config.name,
    machineUsers: authService.config.machineUsers
      ? Object.keys(authService.config.machineUsers)
      : undefined,
    dbConfig: dbConfigMap,
    env: migrationContext.config.env ?? {},
    configDir: path.dirname(migrationContext.config.path),
  };
}

type TailorDBPlanResult = Awaited<ReturnType<typeof planTailorDB>>;

async function validateTailorDBMigrationState(
  client: OperatorClient,
  result: TailorDBPlanResult,
): Promise<ValidateAndDetectResult> {
  const { context } = result;
  const typesByNamespace = new Map<string, Record<string, TailorDBSnapshotType>>();
  for (const tailordb of context.tailorDBInputs) {
    typesByNamespace.set(tailordb.namespace, tailordb.types);
  }

  const validation = await validateAndDetectMigrations(
    client,
    context.workspaceId,
    typesByNamespace,
    context.config,
    context.noSchemaCheck,
    context.tailorDBInputs,
  );
  const approvedRepairs = context.checkpointRepairs;
  const repairPlanChanged =
    approvedRepairs.length !== validation.checkpointRepairs.length ||
    validation.checkpointRepairs.some(
      (repair) =>
        !approvedRepairs.some(
          (approved) =>
            approved.namespace === repair.namespace &&
            approved.from === repair.from &&
            approved.fromHistoryId === repair.fromHistoryId &&
            approved.toHistoryId === repair.toHistoryId,
        ),
    );
  if (repairPlanChanged) {
    throw new Error(
      "Remote migration checkpoint repair changed after deployment planning. Run the deployment again to review the updated repair.",
    );
  }
  if (!migrationFileStatesEqual(context.migrationFileState, validation.migrationFileState)) {
    throw new Error(
      "Migration files changed after deployment planning. Run the deployment again to create a fresh plan.",
    );
  }
  return validation;
}

/**
 * Revalidate migration state before the deployment enters any mutation phase.
 * @param client - Operator client instance
 * @param result - Planned TailorDB changes
 */
export async function preflightTailorDB(
  client: OperatorClient,
  result: TailorDBPlanResult,
): Promise<void> {
  await validateTailorDBMigrationState(client, result);
}

/**
 * Apply TailorDB-related changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned TailorDB changes
 * @param phase - Apply phase (defaults to "create-update")
 */
export async function applyTailorDB(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planTailorDB>>,
  phase: Exclude<ApplyPhase, "delete"> = "create-update",
): Promise<void> {
  const { changeSet, context: migrationContext } = result;

  if (phase === "create-update") {
    // Plan-time validation makes dry runs fail fast. Repeat the full validation
    // at the apply boundary because migration files, remote checkpoints, or the
    // remote schema may have changed while waiting for confirmation.
    const { pendingMigrations, checkpointRepairs, namespacesWithMigrations, migrationHistoryIds } =
      await validateTailorDBMigrationState(client, result);

    for (const repair of checkpointRepairs) {
      await updateMigrationLabel(
        client,
        migrationContext.workspaceId,
        repair.namespace,
        repair.to,
        repair.toHistoryId,
      );
      logger.info(
        `Migration checkpoint for namespace ${repair.namespace} reset: ${formatMigrationNumber(repair.from)} → 0000.`,
      );
    }

    if (pendingMigrations.length > 0) {
      // Migration flow: Execute each migration sequentially (pre -> script -> post)
      // This ensures intermediate states are properly handled when scripts depend on them

      // Reset tracking state for this migration run
      processedTypes.reset();
      deletedResources.reset();
      migrationSnapshotCache.reset();

      // Step 1: Create/update services once at the beginning (services don't need per-migration handling)
      await executeServicesCreation(client, changeSet);

      // Step 1.5: The migration loop below only touches the namespaces of the
      // pending migrations; changes planned for every other namespace must go
      // through the normal flow or they would be silently dropped.
      // Creates/updates run before the loop so migration scripts see the
      // complete world; deletes are irreversible and stay last (Step 5).
      const migratingNamespaces = new Set(pendingMigrations.map((m) => m.namespace));
      const isOutsideMigrations = (namespaceName: string | undefined) =>
        namespaceName !== undefined && !migratingNamespaces.has(namespaceName);

      try {
        for (const create of changeSet.type.creates) {
          if (!isOutsideMigrations(create.request.namespaceName)) continue;
          await client.createTailorDBType(create.request);
        }
        for (const update of changeSet.type.updates) {
          if (!isOutsideMigrations(update.request.namespaceName)) continue;
          await client.updateTailorDBType(update.request);
        }
      } catch (error) {
        handleOptionalToRequiredError(error, [
          "Run 'tailor tailordb migration generate' to create migration files.",
          "Migration scripts allow you to handle existing data before applying the schema change.",
        ]);
      }
      await Promise.all([
        ...changeSet.gqlPermission.creates
          .filter((create) => isOutsideMigrations(create.request.namespaceName))
          .map((create) => client.createTailorDBGQLPermission(create.request)),
        ...changeSet.gqlPermission.updates
          .filter((update) => isOutsideMigrations(update.request.namespaceName))
          .map((update) => client.updateTailorDBGQLPermission(update.request)),
      ]);

      const migrationsRequiringScripts = pendingMigrations.filter((m) => m.hasScript);

      // Step 2: Build migration context for script execution (if any migrations require scripts)
      const migrationCtx =
        migrationsRequiringScripts.length > 0
          ? buildMigrationContextForScripts(client, migrationContext, migrationsRequiringScripts)
          : undefined;

      // Step 3: Execute each migration sequentially: pre -> script -> post
      if (migrationsRequiringScripts.length > 0) {
        logger.info(`Executing ${migrationsRequiringScripts.length} data migration(s)...`);
        logger.newline();
      }

      for (const migration of pendingMigrations) {
        try {
          // Pre-migration phase: Create/update types with breaking fields as optional
          await executeSingleMigrationPrePhase(
            client,
            changeSet,
            migration,
            migrationContext.tailorDBInputs,
            migrationContext.executorUsedTypes,
          );

          // Script execution (only if migrate.ts exists for this migration)
          if (migration.hasScript && migrationCtx) {
            await executeMigrations(migrationCtx, [migration]);
          }
        } catch (error) {
          // Best-effort revert of committed Pre-phase DDL; must not mask the original error.
          try {
            await rollbackSingleMigrationPrePhase(
              client,
              changeSet,
              migration,
              migrationContext.workspaceId,
              migrationContext.tailorDBInputs,
              migrationContext.executorUsedTypes,
            );
          } catch (rollbackError) {
            logger.warn(
              `Failed to roll back migration ${migration.namespace}/${formatMigrationNumber(migration.number)}: ` +
                `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            );
          }
          throw error;
        }

        // Post-migration phase: Apply final types (required: true) and deletions.
        // Not rolled back on failure: deletions here are irreversible.
        await executeSingleMigrationPostPhase(
          client,
          changeSet,
          migration,
          migrationContext.tailorDBInputs,
          migrationContext.executorUsedTypes,
        );

        // Update migration label only after all phases complete successfully
        await updateMigrationLabel(
          client,
          migrationContext.workspaceId,
          migration.namespace,
          migration.number,
          migrationHistoryIds[migration.namespace] ?? undefined,
        );
      }

      if (migrationsRequiringScripts.length > 0) {
        logger.newline();
        logger.success(`All data migrations completed successfully.`);
      }

      // Step 4: Delete remaining GQL permissions that weren't deleted with their types
      const remainingGqlPermissionDeletes = changeSet.gqlPermission.deletes.filter((del) => {
        const permKey = `${del.request.namespaceName}/${del.name}`;
        return !deletedResources.gqlPermissions.has(permKey);
      });
      if (remainingGqlPermissionDeletes.length > 0) {
        await Promise.all(
          remainingGqlPermissionDeletes.map((del) =>
            client.deleteTailorDBGQLPermission(del.request),
          ),
        );
      }

      // Step 5: Delete types outside the migrating namespaces (their GQL
      // permissions were just removed above; migration postPhases never see them)
      await Promise.all(
        changeSet.type.deletes
          .filter(
            (del) =>
              isOutsideMigrations(del.request.namespaceName) &&
              !deletedResources.types.has(del.name),
          )
          .map((del) => client.deleteTailorDBType(del.request)),
      );

      // Step 6: Write type metadata, which the migration phases above do not.
      // Types inside migrating namespaces only exist once their phases have run,
      // so this waits until every type in the change set is present. Skipping it
      // would leave a cross-config dependency record unwritten on any deploy that
      // carries a migration, and the owner's next solo deploy would turn
      // publishing off without asking.
      await Promise.all(
        [...changeSet.type.creates, ...changeSet.type.updates, ...changeSet.type.unchanged]
          .filter((entry) => entry.metaRequest && !deletedResources.types.has(entry.name))
          .flatMap((entry) =>
            entry.metaRequest ? [writeMetadataLabels(client, entry.metaRequest)] : [],
          ),
      );
    } else {
      // Normal create-update flow without migrations
      // Services
      await Promise.all([
        ...changeSet.service.creates.map(async (create) => {
          await client.createTailorDBService(create.request);
          await writeMetadataLabels(client, create.metaRequest);
        }),
        ...changeSet.service.updates.map((update) =>
          writeMetadataLabels(client, update.metaRequest),
        ),
      ]);

      // Types. An unchanged type still gets its labels written, because its
      // dependency records can change while its schema does not.
      try {
        for (const create of changeSet.type.creates) {
          await client.createTailorDBType(create.request);
          await writeMetadataLabels(client, create.metaRequest);
        }
        for (const update of changeSet.type.updates) {
          await client.updateTailorDBType(update.request);
          await writeMetadataLabels(client, update.metaRequest);
        }
        await Promise.all(
          changeSet.type.unchanged.flatMap((entry) =>
            entry.metaRequest ? [writeMetadataLabels(client, entry.metaRequest)] : [],
          ),
        );
      } catch (error) {
        handleOptionalToRequiredError(error, [
          "Run 'tailor tailordb migration generate' to create migration files.",
          "Migration scripts allow you to handle existing data before applying the schema change.",
        ]);
      }

      // GQLPermissions
      await Promise.all([
        ...changeSet.gqlPermission.creates.map((create) =>
          client.createTailorDBGQLPermission(create.request),
        ),
        ...changeSet.gqlPermission.updates.map((update) =>
          client.updateTailorDBGQLPermission(update.request),
        ),
      ]);

      // Delete resources (only when no migrations occurred)
      // Migrations already handle deletions in post-migration phase
      await Promise.all(
        changeSet.gqlPermission.deletes.map((del) =>
          client.deleteTailorDBGQLPermission(del.request),
        ),
      );
      await Promise.all(
        changeSet.type.deletes.map((del) => client.deleteTailorDBType(del.request)),
      );
    }

    // Skip when pending migrations ran: each already bumped the label, and
    // re-pinning to working_tree_max could mask one left intentionally pending
    // (e.g. a missing script). --no-schema-check always re-pins to repair drift.
    if (
      namespacesWithMigrations.length > 0 &&
      (migrationContext.noSchemaCheck || pendingMigrations.length === 0)
    ) {
      await reconcileMigrationLabels(
        client,
        migrationContext.workspaceId,
        namespacesWithMigrations,
        migrationHistoryIds,
      );
    }
  } else if (phase === "delete-resources") {
    // Delete GQL permissions first, then types
    await Promise.all(
      changeSet.gqlPermission.deletes.map((del) => client.deleteTailorDBGQLPermission(del.request)),
    );
    await Promise.all(changeSet.type.deletes.map((del) => client.deleteTailorDBType(del.request)));
  } else {
    // Services only
    await Promise.all(
      changeSet.service.deletes.map((del) => client.deleteTailorDBService(del.request)),
    );
  }
}

// ============================================================================
// Error Handling Helpers
// ============================================================================

// ============================================================================
// Migration Execution Helpers
// ============================================================================

type TailorDBChangeSet = Awaited<ReturnType<typeof planTailorDB>>["changeSet"];

/**
 * Get the set of type names affected by a migration
 * @param {PendingMigration} migration - Pending migration
 * @returns {Set<string>} Set of affected type names
 */
function getAffectedTypeNames(migration: PendingMigration): Set<string> {
  const typeNames = new Set<string>();
  for (const change of migration.diff.changes) {
    typeNames.add(change.typeName);
  }
  return typeNames;
}

/**
 * Get the set of type names to be deleted by a migration
 * @param {PendingMigration} migration - Pending migration
 * @returns {Set<string>} Set of type names to delete
 */
function getDeletedTypeNames(migration: PendingMigration): Set<string> {
  const typeNames = new Set<string>();
  for (const change of migration.diff.changes) {
    if (change.kind === "type_removed") {
      typeNames.add(change.typeName);
    }
  }
  return typeNames;
}

/**
 * Execute services creation (called once at the beginning of migration flow)
 * @param {OperatorClient} client - Operator client instance
 * @param {TailorDBChangeSet} changeSet - TailorDB change set
 * @returns {Promise<void>} Promise that resolves when services are created
 */
async function executeServicesCreation(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
): Promise<void> {
  await Promise.all([
    ...changeSet.service.creates.map(async (create) => {
      await client.createTailorDBService(create.request);
      await writeMetadataLabels(client, create.metaRequest);
    }),
    ...changeSet.service.updates.map((update) => writeMetadataLabels(client, update.metaRequest)),
  ]);
}

/**
 * Track which types have been created/updated across migrations
 */
const processedTypes = {
  created: new Set<string>(),
  updated: new Set<string>(),
  gqlPermissionsProcessed: new Set<string>(),
  reset() {
    this.created.clear();
    this.updated.clear();
    this.gqlPermissionsProcessed.clear();
  },
};

/**
 * Snapshot cache for per-migration schema lookups during a single apply run.
 *
 * Only the initial baseline `0000/schema.json` is stored on disk; later migrations
 * ship `diff.json` only. To get the schema state AFTER migration N we replay the
 * initial snapshot through all diffs up to N via `reconstructSnapshotFromMigrations`.
 * Results are memoized per (namespace, migration number) for the apply run.
 */
const migrationSnapshotCache = {
  cache: new Map<string, SchemaSnapshot>(),
  reset() {
    this.cache.clear();
  },
  load(migration: PendingMigration): SchemaSnapshot {
    const key = `${migration.namespace}/${migration.number}`;
    let snapshot = this.cache.get(key);
    if (!snapshot) {
      const reconstructed = reconstructSnapshotFromMigrations(
        migration.migrationsDir,
        migration.number,
      );
      if (!reconstructed) {
        throw new Error(
          `Cannot reconstruct snapshot for ${migration.namespace} migration ${migration.number}: no migrations found in ${migration.migrationsDir}`,
        );
      }
      snapshot = reconstructed;
      this.cache.set(key, snapshot);
    }
    return snapshot;
  },
};

function buildSnapshotTypeManifest(
  migration: PendingMigration,
  typeName: string,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  executorUsedTypes: ReadonlySet<string>,
): MessageInitShape<typeof TailorDBTypeSchema> | undefined {
  const snapshot = migrationSnapshotCache.load(migration);
  const snapshotType = snapshot.types[typeName];
  if (!snapshotType) return undefined;
  const input = tailorDBInputs.find((i) => i.namespace === migration.namespace);
  return generateTailorDBTypeManifestFromSnapshot(snapshotType, {
    subscribed: executorUsedTypes.has(snapshotType.name),
    namespaceGqlOperations: input?.config.gqlOperations,
  });
}

/**
 * Await every promise to settle, then throw the first rejection. Unlike
 * `Promise.all`, this never leaves sibling operations in flight after a failure,
 * so a following rollback cannot race with still-pending DDL.
 * @param promises - Promises (or already-resolved values) to await
 * @returns {Promise<void>} Resolves once all settle; rejects with the first failure
 */
async function awaitAllSettledOrThrow(
  promises: ReadonlyArray<Promise<unknown> | undefined>,
): Promise<void> {
  const results = await Promise.allSettled(promises);
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (rejected) {
    throw rejected.reason;
  }
}

/**
 * Execute pre-migration phase for a single migration
 * @param {OperatorClient} client - Operator client instance
 * @param {TailorDBChangeSet} changeSet - TailorDB change set
 * @param {PendingMigration} migration - Single pending migration
 * @param tailorDBInputs - Deploy inputs, used to resolve namespace gqlOperations for the snapshot
 * @param executorUsedTypes - Types used by executors (drives publishRecordEvents default)
 * @returns {Promise<void>} Promise that resolves when pre-migration phase completes
 */
async function executeSingleMigrationPrePhase(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  migration: PendingMigration,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  executorUsedTypes: ReadonlySet<string>,
): Promise<void> {
  // Build pre-migration changes maps for this single migration. Includes both
  // breaking changes (required-add, unique-add, enum value removal) and the
  // warning-tier field_removed, since the Pre-phase relaxes both, plus the
  // breaking type-level index changes.
  const preMigrationChanges = buildPreMigrationChangesMap([migration]);
  const preMigrationIndexChanges = buildPreMigrationIndexChangesMap([migration]);
  const affectedTypes = getAffectedTypeNames(migration);
  const createdBeforeMigration = new Set(processedTypes.created);

  for (const create of changeSet.type.creates) {
    const typeName = create.request.tailordbType?.name;
    if (!typeName || !affectedTypes.has(typeName) || createdBeforeMigration.has(typeName)) {
      continue;
    }
    const snapshotType = buildSnapshotTypeManifest(
      migration,
      typeName,
      tailorDBInputs,
      executorUsedTypes,
    );
    if (!snapshotType) continue;

    const clonedRequest = structuredClone(create.request);
    clonedRequest.tailordbType = snapshotType;

    const typeChanges = preMigrationChanges.get(typeName);
    if (typeChanges && typeChanges.size > 0 && clonedRequest.tailordbType.schema?.fields) {
      applyPreMigrationFieldAdjustments(clonedRequest.tailordbType.schema.fields, typeChanges);
    }
    const indexChanges = preMigrationIndexChanges.get(typeName);
    if (indexChanges && indexChanges.size > 0 && clonedRequest.tailordbType.schema?.indexes) {
      applyPreMigrationIndexAdjustments(clonedRequest.tailordbType.schema.indexes, indexChanges);
    }

    processedTypes.created.add(typeName);
    await client.createTailorDBType(clonedRequest);
  }

  for (const create of changeSet.type.creates) {
    const typeName = create.request.tailordbType?.name;
    if (!typeName || !affectedTypes.has(typeName) || !createdBeforeMigration.has(typeName)) {
      continue;
    }
    const snapshotType = buildSnapshotTypeManifest(
      migration,
      typeName,
      tailorDBInputs,
      executorUsedTypes,
    );
    if (!snapshotType) continue;

    const clonedTypeRequest = structuredClone(snapshotType);
    const typeChanges = preMigrationChanges.get(typeName);
    if (typeChanges && typeChanges.size > 0 && clonedTypeRequest.schema?.fields) {
      applyPreMigrationFieldAdjustments(clonedTypeRequest.schema.fields, typeChanges);
    }
    const indexChanges = preMigrationIndexChanges.get(typeName);
    if (indexChanges && indexChanges.size > 0 && clonedTypeRequest.schema?.indexes) {
      applyPreMigrationIndexAdjustments(clonedTypeRequest.schema.indexes, indexChanges);
    }

    processedTypes.updated.add(typeName);
    await client.updateTailorDBType({
      workspaceId: create.request.workspaceId,
      namespaceName: create.request.namespaceName,
      tailordbType: clonedTypeRequest,
    });
  }

  for (const update of changeSet.type.updates) {
    const typeName = update.request.tailordbType?.name;
    if (!typeName || !affectedTypes.has(typeName)) continue;
    const snapshotType = buildSnapshotTypeManifest(
      migration,
      typeName,
      tailorDBInputs,
      executorUsedTypes,
    );
    if (!snapshotType) continue;

    const clonedRequest = structuredClone(update.request);
    clonedRequest.tailordbType = snapshotType;

    const typeChanges = preMigrationChanges.get(typeName);
    if (typeChanges && typeChanges.size > 0 && clonedRequest.tailordbType.schema?.fields) {
      applyPreMigrationFieldAdjustments(clonedRequest.tailordbType.schema.fields, typeChanges);
    }
    const indexChanges = preMigrationIndexChanges.get(typeName);
    if (indexChanges && indexChanges.size > 0 && clonedRequest.tailordbType.schema?.indexes) {
      applyPreMigrationIndexAdjustments(clonedRequest.tailordbType.schema.indexes, indexChanges);
    }

    processedTypes.updated.add(typeName);
    await client.updateTailorDBType(clonedRequest);
  }

  // GQLPermissions - process once (on the first migration)
  if (!processedTypes.gqlPermissionsProcessed.has(migration.namespace)) {
    const gqlPermissionCreatesForNamespace = changeSet.gqlPermission.creates.filter(
      (create) => create.request.namespaceName === migration.namespace,
    );
    const gqlPermissionUpdatesForNamespace = changeSet.gqlPermission.updates.filter(
      (update) => update.request.namespaceName === migration.namespace,
    );
    const gqlPermissionTypeNames = new Set(
      gqlPermissionCreatesForNamespace.map((create) => create.name),
    );
    const missingTypeCreates = changeSet.type.creates.filter((create) => {
      const typeName = create.request.tailordbType?.name;
      const namespaceName = create.request.namespaceName;
      return (
        namespaceName === migration.namespace &&
        typeName &&
        gqlPermissionTypeNames.has(typeName) &&
        !processedTypes.created.has(typeName)
      );
    });
    if (missingTypeCreates.length > 0) {
      for (const create of missingTypeCreates) {
        const typeName = create.request.tailordbType?.name;
        if (typeName) processedTypes.created.add(typeName);
        await client.createTailorDBType(create.request);
      }
    }
    processedTypes.gqlPermissionsProcessed.add(migration.namespace);
    await awaitAllSettledOrThrow([
      ...gqlPermissionCreatesForNamespace.map((create) =>
        client.createTailorDBGQLPermission(create.request),
      ),
      ...gqlPermissionUpdatesForNamespace.map((update) =>
        client.updateTailorDBGQLPermission(update.request),
      ),
    ]);
  }
}

/**
 * Track which types/permissions have been deleted across migrations
 */
const deletedResources = {
  types: new Set<string>(),
  gqlPermissions: new Set<string>(),
  reset() {
    this.types.clear();
    this.gqlPermissions.clear();
  },
};

/**
 * Execute post-migration phase for a single migration: Apply final types (with required: true) and deletions
 * @param {OperatorClient} client - Operator client instance
 * @param {TailorDBChangeSet} changeSet - TailorDB change set
 * @param {PendingMigration} migration - Single pending migration
 * @param tailorDBInputs - Deploy inputs, used to resolve namespace gqlOperations for the snapshot
 * @param executorUsedTypes - Types used by executors (drives publishRecordEvents default)
 * @returns {Promise<void>} Promise that resolves when post-migration phase completes
 */
async function executeSingleMigrationPostPhase(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  migration: PendingMigration,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  executorUsedTypes: ReadonlySet<string>,
): Promise<void> {
  // Re-use the pre-migration changes maps to know which types were touched in
  // this migration (so we send the post-phase final-schema update for them).
  const preMigrationChanges = buildPreMigrationChangesMap([migration]);
  const preMigrationIndexChanges = buildPreMigrationIndexChangesMap([migration]);
  const adjustedTypes = new Set([
    ...preMigrationChanges.keys(),
    ...preMigrationIndexChanges.keys(),
  ]);
  const affectedTypes = getAffectedTypeNames(migration);
  const deletedTypeNames = getDeletedTypeNames(migration);

  // Types - apply schema as of migration N (= snapshot[N]) with all breaking
  // changes enforced. The prePhase sent the same schema with breaking fields
  // relaxed; here we send it again without relaxation so required/unique/etc.
  // take effect after the data script has reconciled records.
  try {
    // For newly created types that had pre-migration adjustments in this migration, send update with snapshot[N] values
    for (const create of changeSet.type.creates) {
      const typeName = create.request.tailordbType?.name;
      if (!typeName || !affectedTypes.has(typeName) || !adjustedTypes.has(typeName)) {
        continue;
      }
      const snapshotType = buildSnapshotTypeManifest(
        migration,
        typeName,
        tailorDBInputs,
        executorUsedTypes,
      );
      if (!snapshotType) continue;
      await client.updateTailorDBType({
        workspaceId: create.request.workspaceId,
        namespaceName: create.request.namespaceName,
        tailordbType: snapshotType,
      });
    }

    // For updated types affected by this migration, send update with snapshot[N] values
    for (const update of changeSet.type.updates) {
      const typeName = update.request.tailordbType?.name;
      if (!typeName || !affectedTypes.has(typeName) || !adjustedTypes.has(typeName)) {
        continue;
      }
      const snapshotType = buildSnapshotTypeManifest(
        migration,
        typeName,
        tailorDBInputs,
        executorUsedTypes,
      );
      if (!snapshotType) continue;
      await client.updateTailorDBType({
        workspaceId: update.request.workspaceId,
        namespaceName: update.request.namespaceName,
        tailordbType: snapshotType,
      });
    }
  } catch (error) {
    handleOptionalToRequiredError(error, [
      "This error occurred during post-migration phase. Please check your migration script.",
      "Ensure all existing records have values for fields being changed to required.",
    ]);
  }

  // Delete types that are removed in this migration
  if (deletedTypeNames.size > 0) {
    // First delete GQL permissions for the types being deleted
    const gqlPermissionsToDelete = changeSet.gqlPermission.deletes.filter((del) => {
      const permKey = `${del.request.namespaceName}/${del.name}`;
      if (deletedResources.gqlPermissions.has(permKey)) return false;
      // Check if this permission is for a type being deleted in this migration
      // del.name and del.request.typeName both hold the type name
      const typeName = del.name;
      if (typeName && deletedTypeNames.has(typeName)) {
        deletedResources.gqlPermissions.add(permKey);
        return true;
      }
      return false;
    });
    await Promise.all(
      gqlPermissionsToDelete.map((del) => client.deleteTailorDBGQLPermission(del.request)),
    );

    // Then delete the types
    const typesToDelete = changeSet.type.deletes.filter((del) => {
      // del.name and del.request.tailordbTypeName both hold the type name
      const typeName = del.name;
      if (!typeName || deletedResources.types.has(typeName)) return false;
      if (deletedTypeNames.has(typeName)) {
        deletedResources.types.add(typeName);
        return true;
      }
      return false;
    });
    await Promise.all(typesToDelete.map((del) => client.deleteTailorDBType(del.request)));
  }
}

/**
 * Revert a single migration's Pre-phase DDL to the prior checkpoint's schema.
 * @param client - Operator client instance
 * @param changeSet - TailorDB change set
 * @param migration - The migration whose Pre-phase DDL must be reverted
 * @param workspaceId - Workspace ID
 * @param tailorDBInputs - Deploy inputs, used to resolve namespace gqlOperations for the snapshot
 * @param executorUsedTypes - Types used by executors (drives publishRecordEvents default)
 * @returns {Promise<void>} Promise that resolves when rollback attempts complete
 */
async function rollbackSingleMigrationPrePhase(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  migration: PendingMigration,
  workspaceId: string,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  executorUsedTypes: ReadonlySet<string>,
): Promise<void> {
  // The baseline migration has no prior checkpoint to revert to.
  if (migration.number <= INITIAL_SCHEMA_NUMBER) return;

  // `processedTypes` spans every namespace touched in this apply run; restrict
  // rollback to this migration's namespace (its diff plus this namespace's
  // change-set entries). Type names are unique across namespaces, so a name from
  // another namespace simply won't appear in this set.
  const namespaceTypes = getAffectedTypeNames(migration);
  for (const create of changeSet.type.creates) {
    const name = create.request.tailordbType?.name;
    if (create.request.namespaceName === migration.namespace && name) namespaceTypes.add(name);
  }
  for (const update of changeSet.type.updates) {
    const name = update.request.tailordbType?.name;
    if (update.request.namespaceName === migration.namespace && name) namespaceTypes.add(name);
  }

  // Of those, only the types this apply run actually created or updated (so
  // rollback is a no-op when nothing was applied and never touches drift).
  const applied = new Set([...processedTypes.created, ...processedTypes.updated]);
  const rollbackTypes = new Set([...namespaceTypes].filter((name) => applied.has(name)));
  if (rollbackTypes.size === 0) return;

  const priorSnapshot = reconstructSnapshotFromMigrations(
    migration.migrationsDir,
    migration.number - 1,
  );
  // Without the prior snapshot, pre-existing and new types are indistinguishable;
  // deleting them all would be destructive, so leave the schema untouched.
  if (!priorSnapshot) {
    logger.warn(
      `Cannot roll back migration ${migration.namespace}/${formatMigrationNumber(migration.number)}: ` +
        `prior snapshot (migration ${formatMigrationNumber(migration.number - 1)}) could not be reconstructed. ` +
        "Leaving schema as-is; manual repair may be required.",
    );
    return;
  }
  const input = tailorDBInputs.find((i) => i.namespace === migration.namespace);

  logger.warn(
    `Migration ${migration.namespace}/${formatMigrationNumber(migration.number)} failed; ` +
      "rolling back its pre-migration schema changes.",
  );

  for (const typeName of rollbackTypes) {
    const priorType = priorSnapshot.types[typeName];
    try {
      if (priorType) {
        const manifest = generateTailorDBTypeManifestFromSnapshot(priorType, {
          subscribed: executorUsedTypes.has(priorType.name),
          namespaceGqlOperations: input?.config.gqlOperations,
        });
        await client.updateTailorDBType({
          workspaceId,
          namespaceName: migration.namespace,
          tailordbType: manifest,
        });
      } else {
        // New type: its GQL permission must go first (type deletion does not
        // cascade). The permission may not exist, so the delete is best-effort.
        await client
          .deleteTailorDBGQLPermission({
            workspaceId,
            namespaceName: migration.namespace,
            typeName,
          })
          .catch(() => undefined);
        await client.deleteTailorDBType({
          workspaceId,
          namespaceName: migration.namespace,
          tailordbTypeName: typeName,
        });
      }
    } catch (rollbackError) {
      logger.warn(
        `Failed to roll back type '${typeName}' in namespace '${migration.namespace}': ` +
          `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }
  }
}

/**
 * Plan TailorDB-related changes based on current and desired state.
 * @param context - Planning context
 * @returns Planned changes
 */
export async function planTailorDB(context: PlanContext) {
  const {
    client,
    workspaceId,
    application,
    forRemoval,
    config,
    noSchemaCheck,
    forceApplyAll = false,
  } = context;
  const tailordbs: TailorDBDeployInput[] = [];
  if (!forRemoval) {
    for (const tailordb of application.tailorDBServices) {
      await tailordb.loadTypes();
      tailordbs.push(toTailorDBDeployInput(tailordb));
    }
  }
  const executors = forRemoval
    ? []
    : Object.values((await application.executorService?.loadExecutors()) ?? {});
  const executorUsedTypes = new Set(context.executorUsedTailorDBTypes ?? []);
  for (const executor of executors) {
    if (executor.trigger.kind === "tailordb") {
      executorUsedTypes.add(executor.trigger.typeName);
    }
  }

  // Validate migrations at plan time so a missing migration script fails the
  // deploy (including --dry-run) before any resource is applied.
  const typesByNamespace = new Map<string, Record<string, TailorDBSnapshotType>>();
  for (const tailordb of tailordbs) {
    typesByNamespace.set(tailordb.namespace, tailordb.types);
  }
  const { namespacesWithMigrations, migrationFileState, checkpointRepairs } = forRemoval
    ? { namespacesWithMigrations: [], migrationFileState: {}, checkpointRepairs: [] }
    : await validateAndDetectMigrations(
        client,
        workspaceId,
        typesByNamespace,
        config,
        noSchemaCheck ?? false,
        tailordbs,
      );

  const {
    changeSet: serviceChangeSet,
    conflicts,
    unmanaged,
    resourceOwners,
  } = await planServices(client, workspaceId, application.name, application.id, tailordbs);
  const deletedServices = serviceChangeSet.deletes.map((del) => del.name);
  const [typeChangeSet, gqlPermissionChangeSet] = await Promise.all([
    planTypes(
      client,
      workspaceId,
      tailordbs,
      executorUsedTypes,
      deletedServices,
      undefined,
      forceApplyAll,
      {
        appName: application.name,
        appId: application.id,
        dependentApps: context.dependentApps,
        runAppIds: context.runAppIds,
      },
    ),
    planGqlPermissions(client, workspaceId, tailordbs, deletedServices, forceApplyAll),
  ]);

  // Apply type DDL in a stable, name-sorted order so the create burst (capped
  // by the operator client's concurrency limiter) is reproducible across runs.
  typeChangeSet.creates.sort(byName);
  typeChangeSet.updates.sort(byName);
  typeChangeSet.deletes.sort(byName);

  return {
    changeSet: {
      service: serviceChangeSet,
      type: typeChangeSet,
      gqlPermission: gqlPermissionChangeSet,
    },
    conflicts,
    unmanaged,
    resourceOwners,
    context: {
      workspaceId,
      application,
      tailorDBInputs: tailordbs,
      executorUsedTypes,
      config,
      noSchemaCheck: noSchemaCheck ?? false,
      namespacesWithMigrations,
      migrationFileState,
      checkpointRepairs,
    },
  };
}

type TailorDBDisplayEntry = GroupedDisplayEntry;

type NamespacedItem = HasName & { request?: { namespaceName?: string } };

function itemKey(item: NamespacedItem): string {
  return `${item.request?.namespaceName ?? ""}/${item.name}`;
}

function collectTailorDBDisplayEntries(
  action: DisplayAction,
  typeItems: ReadonlyArray<NamespacedItem>,
  gqlPermissionItems: ReadonlyArray<NamespacedItem>,
): TailorDBDisplayEntry[] {
  const typeKeys = new Set(typeItems.map(itemKey));
  const gqlPermissionKeys = new Set(gqlPermissionItems.map(itemKey));
  const typeEntries = typeItems.map((item) => ({
    action,
    symbol: ACTION_SYMBOLS[action],
    name: item.name,
    labels: gqlPermissionKeys.has(itemKey(item)) ? ["type", "gqlPermission"] : ["type"],
    namespace: item.request?.namespaceName,
  }));
  const gqlPermissionOnlyEntries = gqlPermissionItems
    .filter((item) => !typeKeys.has(itemKey(item)))
    .map((item) => ({
      action,
      symbol: ACTION_SYMBOLS[action],
      name: item.name,
      labels: ["gqlPermission"],
      namespace: item.request?.namespaceName,
    }));

  return [...typeEntries, ...gqlPermissionOnlyEntries];
}

/**
 * Format TailorDB type and gqlPermission changes as grouped dry-run entries.
 * @param typeChangeSet - TailorDB type changes
 * @param gqlPermissionChangeSet - TailorDB gqlPermission changes
 * @returns Display entries for TailorDB resource output
 */
export function formatTailorDBResourceChangeEntries(
  typeChangeSet: Pick<
    ChangeSet<HasName, HasName, HasName>,
    "creates" | "updates" | "deletes" | "replaces"
  >,
  gqlPermissionChangeSet: Pick<
    ChangeSet<HasName, HasName, HasName>,
    "creates" | "updates" | "deletes" | "replaces"
  >,
): TailorDBDisplayEntry[] {
  return [
    ...collectTailorDBDisplayEntries(
      "create",
      typeChangeSet.creates,
      gqlPermissionChangeSet.creates,
    ),
    ...collectTailorDBDisplayEntries(
      "delete",
      typeChangeSet.deletes,
      gqlPermissionChangeSet.deletes,
    ),
    ...collectTailorDBDisplayEntries(
      "update",
      typeChangeSet.updates,
      gqlPermissionChangeSet.updates,
    ),
    ...collectTailorDBDisplayEntries(
      "replace",
      typeChangeSet.replaces,
      gqlPermissionChangeSet.replaces,
    ),
  ];
}

type CreateService = {
  name: string;
  request: MessageInitShape<typeof CreateTailorDBServiceRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type UpdateService = {
  name: string;
  metaRequest: MetadataLabelWrite;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBServiceRequestSchema>;
};

function normalizeComparableTailorDBService(service: {
  namespace?: string;
  defaultTimezone?: string;
}) {
  return normalizeProtoConfig({
    namespace: service.namespace,
    defaultTimezone: service.defaultTimezone || "UTC",
  });
}

function areTailorDBServicesEqual(
  existing: {
    namespace?: { name?: string };
    defaultTimezone?: string;
  },
  desired: Readonly<TailorDBDeployInput>,
): boolean {
  return areNormalizedEqual(
    normalizeComparableTailorDBService({
      namespace: existing.namespace?.name,
      defaultTimezone: existing.defaultTimezone,
    }),
    normalizeComparableTailorDBService({
      namespace: desired.namespace,
      defaultTimezone: "UTC",
    }),
  );
}

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  appId: string | undefined,
  tailordbs: ReadonlyArray<TailorDBDeployInput>,
) {
  const changeSet = createChangeSet<CreateService, UpdateService, DeleteService>(
    "TailorDB services",
  );
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const existingServices = await fetchExistingResourcesWithLabels({
    client,
    fetchPage: async (pageToken, maxPageSize) => {
      const { tailordbServices, nextPageToken } = await client.listTailorDBServices({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [tailordbServices, nextPageToken];
    },
    getName: (resource) => resource.namespace?.name,
    getTrn: (name) => resourceTrn(workspaceId, "tailordb", name),
  });

  for (const tailordb of tailordbs) {
    const existing = existingServices[tailordb.namespace];
    const metaRequest = await buildMetaRequest({
      trn: resourceTrn(workspaceId, "tailordb", tailordb.namespace),
      appName,
      appId,
    });
    if (existing) {
      const owned = trackDesiredResourceOwnership({
        labels: existing.allLabels,
        ownerLabel: existing.label,
        appName,
        appId,
        resourceType: "TailorDB service",
        resourceName: tailordb.namespace,
        conflicts,
        unmanaged,
      });

      if (
        owned &&
        hasMatchingSdkVersion(existing.allLabels, metaRequest.labels) &&
        areTailorDBServicesEqual(existing.resource, tailordb)
      ) {
        changeSet.unchanged.push({ name: tailordb.namespace });
      } else {
        changeSet.updates.push({
          name: tailordb.namespace,
          metaRequest,
        });
      }
      delete existingServices[tailordb.namespace];
    } else {
      changeSet.creates.push({
        name: tailordb.namespace,
        request: {
          workspaceId,
          namespaceName: tailordb.namespace,
          // Keep generated TailorDB services aligned with Terraform defaults.
          defaultTimezone: "UTC",
        },
        metaRequest,
      });
    }
  }
  Object.entries(existingServices).forEach(([namespaceName]) => {
    const entry = existingServices[namespaceName];
    const owned = trackRemainingResourceOwner({
      labels: entry?.allLabels,
      ownerLabel: entry?.label,
      appName,
      appId,
      resourceOwners,
    });
    if (owned) {
      changeSet.deletes.push({
        name: namespaceName,
        request: {
          workspaceId,
          namespaceName,
        },
      });
    }
  });

  return { changeSet, conflicts, unmanaged, resourceOwners };
}

type CreateType = {
  name: string;
  request: MessageInitShape<typeof CreateTailorDBTypeRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type UpdateType = {
  name: string;
  request: MessageInitShape<typeof UpdateTailorDBTypeRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

/**
 * A type whose schema is unchanged but whose dependency records may not be. The
 * plan shows it as unchanged; apply still writes its labels.
 */
type UnchangedType = {
  name: string;
  metaRequest?: MetadataLabelWrite;
};

/** What planTypes needs to record dependencies on each type. */
type TypeRecordInputs = {
  appName?: string;
  appId?: string;
  dependentApps?: DependentAppsByResource;
  runAppIds?: ReadonlySet<string>;
};

type DeleteType = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBTypeRequestSchema>;
};

async function planTypes(
  client: OperatorClient,
  workspaceId: string,
  tailordbs: ReadonlyArray<TailorDBDeployInput>,
  executorUsedTypes: ReadonlySet<string>,
  deletedServices: ReadonlyArray<string>,
  filteredTypesByNamespace?: Map<string, Record<string, TailorDBSnapshotType>>,
  forceApplyAll = false,
  records: TypeRecordInputs = {},
) {
  const changeSet = createChangeSet<CreateType, UpdateType, DeleteType, never, UnchangedType>(
    "TailorDB types",
  );
  const { appName, appId, dependentApps, runAppIds } = records;

  /**
   * Build one type's metadata write, carrying the dependency records that belong
   * to it. The type is what publishes record events, so the record lives there.
   * @param namespace - Namespace holding the type
   * @param typeName - Type name
   * @param explicitPublishEvents - `publishEvents` declared on the type, if any
   * @returns The type's metadata write
   */
  const typeMetaRequest = async (
    namespace: string,
    typeName: string,
    explicitPublishEvents: boolean | undefined,
  ) => {
    const trn = tailorDBTypeTrn(workspaceId, namespace, typeName);
    return addDependencyRecords(await buildMetaRequest({ trn, appName: appName ?? "", appId }), {
      key: eventSourceKey.tailorDBType(namespace, typeName),
      dependentApps,
      runAppIds,
      pinned: explicitPublishEvents !== undefined,
    });
  };

  const fetchTypes = (namespaceName: string) => {
    return fetchAllTolerant(async (pageToken, maxPageSize) => {
      const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes({
        workspaceId,
        namespaceName,
        pageToken,
        pageSize: maxPageSize,
      });
      return [tailordbTypes, nextPageToken];
    });
  };

  // Reject a conflicting opt-out before any request, not partway through.
  for (const tailordb of tailordbs) {
    const types = filteredTypesByNamespace?.get(tailordb.namespace) ?? tailordb.types;
    for (const [typeName, type] of Object.entries(types)) {
      assertNoPublishEventsConflict({
        explicit: type.settings?.publishEvents,
        subscribed: executorUsedTypes.has(typeName),
        conflict: publishEventsConflict.tailorDBType(typeName),
      });
    }
  }

  for (const tailordb of tailordbs) {
    const existingTypes = await fetchTypes(tailordb.namespace);
    const existingTypesMap = new Map(existingTypes.map((type) => [type.name, type]));

    // Use filtered types if provided, otherwise use local types
    const types = filteredTypesByNamespace?.get(tailordb.namespace) ?? tailordb.types;
    const typeMeta = (typeName: string) =>
      typeMetaRequest(tailordb.namespace, typeName, types[typeName]?.settings?.publishEvents);

    for (const [typeName, tailordbTypeSnapshot] of Object.entries(types)) {
      const tailordbType = generateTailorDBTypeManifestFromSnapshot(tailordbTypeSnapshot, {
        subscribed: executorUsedTypes.has(typeName),
        namespaceGqlOperations: tailordb.config.gqlOperations,
      });
      const existingType = existingTypesMap.get(typeName);
      if (existingType) {
        if (
          !forceApplyAll &&
          areNormalizedEqual(
            normalizeComparableTailorDBType(existingType),
            normalizeComparableTailorDBType(tailordbType),
          )
        ) {
          // The schema matches, but the records may not, so the labels still go.
          changeSet.unchanged.push({ name: typeName, metaRequest: await typeMeta(typeName) });
        } else {
          changeSet.updates.push({
            name: typeName,
            request: {
              workspaceId,
              namespaceName: tailordb.namespace,
              tailordbType,
            },
            metaRequest: await typeMeta(typeName),
          });
        }
        existingTypesMap.delete(typeName);
      } else {
        changeSet.creates.push({
          name: typeName,
          request: {
            workspaceId,
            namespaceName: tailordb.namespace,
            tailordbType,
          },
          metaRequest: await typeMeta(typeName),
        });
      }
    }
    existingTypesMap.forEach((_type, name) => {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          namespaceName: tailordb.namespace,
          tailordbTypeName: name,
        },
      });
    });
  }
  for (const namespaceName of deletedServices) {
    const existingTypes = await fetchTypes(namespaceName);
    existingTypes.forEach((typ) => {
      changeSet.deletes.push({
        name: typ.name,
        request: {
          workspaceId,
          namespaceName,
          tailordbTypeName: typ.name,
        },
      });
    });
  }
  return changeSet;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const tailordbCompareKnownDefaults = {
  /**
   * Platform returns this object with explicit false flags even when the SDK omitted
   * gqlOperations entirely. Treat the all-false object as "unset" for diff purposes.
   */
  disableGqlOperations: {
    create: false,
    update: false,
    delete: false,
    read: false,
  },
  /**
   * Some remote validate expressions are emitted as an empty string when the SDK did
   * not define a script. Local manifests omit the field entirely.
   */
  emptyExpression: "",
  /**
   * Proto bigint-backed values can round-trip as numbers locally and strings remotely.
   * Canonicalize them to strings at compare time.
   */
  numericStringPaths: new Set([
    "schema.fields.*.serial.start",
    "schema.fields.*.serial.maxValue",
    "schema.settings.defaultQueryLimitSize",
    "schema.settings.maxBulkUpsertSize",
  ]),
} as const;

function normalizeComparableTailorDBType(type: MessageInitShape<typeof TailorDBTypeSchema>) {
  const canonical = toComparableProtoJson(TailorDBTypeSchema, type);
  const normalized = normalizeProtoConfig(canonical) as {
    name?: string;
    schema?: {
      description?: string;
      fields?: Record<string, unknown>;
      relationships?: Record<string, unknown>;
      settings?: Record<string, unknown>;
      indexes?: Record<string, unknown>;
      files?: Record<string, unknown>;
      permission?: Record<string, unknown>;
      typeHook?: Record<string, unknown>;
      typeValidate?: Record<string, unknown>;
    };
  } | null;
  return normalizeTailorDBCompareValue(
    {
      name: normalized?.name ?? "",
      schema: {
        description: normalized?.schema?.description ?? "",
        fields: normalized?.schema?.fields ?? {},
        relationships: normalized?.schema?.relationships ?? {},
        settings: normalized?.schema?.settings ?? {},
        indexes: normalized?.schema?.indexes ?? {},
        files: normalized?.schema?.files ?? {},
        permission: normalized?.schema?.permission ?? {},
        // Hooks/validators are sent as type-level scripts; include them so a
        // changed hook or validator is detected as an update.
        typeHook: normalized?.schema?.typeHook ?? {},
        typeValidate: normalized?.schema?.typeValidate ?? {},
      },
    },
    [],
  );
}

function isPermissionPolicyArrayPath(path: readonly (string | number)[]): boolean {
  return (
    path.length === 3 &&
    path[0] === "schema" &&
    path[1] === "permission" &&
    (path[2] === "create" || path[2] === "read" || path[2] === "update" || path[2] === "delete")
  );
}

function normalizeTailorDBCompareValue(
  value: unknown,
  path: readonly (string | number)[],
): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === "boolean") {
    if (path.at(-1) === "optionalOnCreate" && value === false) {
      return undefined;
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
    if (matchesNumericStringPath(path) && isNumericLikeValue(value)) {
      return String(value);
    }
    if (
      (path.at(-1) === "expr" || path.at(-1) === "description") &&
      value === tailordbCompareKnownDefaults.emptyExpression
    ) {
      return undefined;
    }
    return value;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item, index) => normalizeTailorDBCompareValue(item, [...path, index]))
      .filter((item) => item !== undefined);
    // Field-level validators are no longer emitted by the SDK (they are aggregated
    // into type-level type_validate). The platform still returns an empty `validate`
    // array per field; treat it as unset so it matches the omitted local value.
    if (items.length === 0 && path.at(-1) === "validate") {
      return undefined;
    }
    // The platform evaluates permission policies order-insensitively (any
    // matching deny wins over any matching allow), while committed migration
    // snapshots can record the same policies in a different order than the
    // current config parse — so compare each action's policies as a set.
    if (isPermissionPolicyArrayPath(path)) {
      return items.toSorted((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    }
    return items;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const normalizedEntries = Object.entries(value)
    .map(
      ([key, entryValue]) =>
        [key, normalizeTailorDBCompareValue(entryValue, [...path, key])] as const,
    )
    .filter(([, entryValue]) => entryValue !== undefined);

  const normalizedObject = Object.fromEntries(normalizedEntries);

  if (path.at(-1) === "fields" && Object.keys(normalizedObject).length === 0) {
    return undefined;
  }

  if (
    path.at(-1) === "disableGqlOperations" &&
    (Object.keys(normalizedObject).length === 0 ||
      areNormalizedEqual(normalizedObject, tailordbCompareKnownDefaults.disableGqlOperations))
  ) {
    return undefined;
  }

  return normalizedObject;
}

function matchesNumericStringPath(path: readonly (string | number)[]): boolean {
  const pathKey = path.map((segment) => String(segment)).join(".");
  return [...tailordbCompareKnownDefaults.numericStringPaths].some((pattern) => {
    const patternParts = pattern.split(".");
    const pathParts = pathKey.split(".");
    if (patternParts.length !== pathParts.length) {
      return false;
    }
    return patternParts.every((part, index) => part === "*" || part === pathParts[index]);
  });
}

function isNumericLikeValue(value: string | number | bigint): boolean {
  return typeof value === "number" || typeof value === "bigint" || /^-?\d+$/.test(value);
}

type CreateGqlPermission = {
  name: string;
  request: MessageInitShape<typeof CreateTailorDBGQLPermissionRequestSchema>;
};

type UpdateGqlPermission = {
  name: string;
  request: MessageInitShape<typeof UpdateTailorDBGQLPermissionRequestSchema>;
};

type DeleteGqlPermission = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBGQLPermissionRequestSchema>;
};

async function planGqlPermissions(
  client: OperatorClient,
  workspaceId: string,
  tailordbs: ReadonlyArray<TailorDBDeployInput>,
  deletedServices: ReadonlyArray<string>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateGqlPermission, UpdateGqlPermission, DeleteGqlPermission>(
    "TailorDB gqlPermissions",
  );

  const fetchGqlPermissions = (namespaceName: string) => {
    return fetchAllTolerant(async (pageToken, maxPageSize) => {
      const { permissions, nextPageToken } = await client.listTailorDBGQLPermissions({
        workspaceId,
        namespaceName,
        pageToken,
        pageSize: maxPageSize,
      });
      return [permissions, nextPageToken];
    });
  };

  for (const tailordb of tailordbs) {
    const existingGqlPermissions = await fetchGqlPermissions(tailordb.namespace);
    const existingNameSet = new Set<string>();
    existingGqlPermissions.forEach((gqlPermission) => {
      existingNameSet.add(gqlPermission.typeName);
    });

    const types = tailordb.types;
    for (const [typeName, typeEntry] of Object.entries(types)) {
      const gqlPermission = typeEntry.permissions?.gql;
      if (!gqlPermission) {
        continue;
      }
      const desiredPermission = protoGqlPermission(gqlPermission);
      const existingPermission = existingGqlPermissions.find(
        (entry) => entry.typeName === typeName,
      );
      if (existingNameSet.has(typeName)) {
        if (
          !forceApplyAll &&
          existingPermission &&
          areNormalizedEqual(
            normalizeComparableGqlPermission(existingPermission.permission),
            normalizeComparableGqlPermission(desiredPermission),
          )
        ) {
          changeSet.unchanged.push({ name: typeName });
        } else {
          changeSet.updates.push({
            name: typeName,
            request: {
              workspaceId,
              namespaceName: tailordb.namespace,
              typeName: typeName,
              permission: desiredPermission,
            },
          });
        }
        existingNameSet.delete(typeName);
      } else {
        changeSet.creates.push({
          name: typeName,
          request: {
            workspaceId,
            namespaceName: tailordb.namespace,
            typeName: typeName,
            permission: desiredPermission,
          },
        });
      }
    }
    existingNameSet.forEach((name) => {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          namespaceName: tailordb.namespace,
          typeName: name,
        },
      });
    });
  }
  for (const namespaceName of deletedServices) {
    const existingGqlPermissions = await fetchGqlPermissions(namespaceName);
    existingGqlPermissions.forEach((gqlPermission) => {
      changeSet.deletes.push({
        name: gqlPermission.typeName,
        request: {
          workspaceId,
          namespaceName,
          typeName: gqlPermission.typeName,
        },
      });
    });
  }
  return changeSet;
}

function normalizeComparableGqlPermission(permission: unknown) {
  const normalized = normalizeProtoConfig(permission) as {
    policies?: Array<{
      actions?: number[];
      conditions?: unknown[];
      permit?: number;
      description?: string;
    }>;
  } | null;
  return {
    policies: (normalized?.policies ?? []).map((policy) => ({
      ...policy,
      actions: (policy.actions ?? []).toSorted((left, right) => left - right),
    })),
  };
}
