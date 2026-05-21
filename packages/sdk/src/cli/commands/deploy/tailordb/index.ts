import { fromJson, type MessageInitShape } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type CreateTailorDBGQLPermissionRequestSchema,
  type CreateTailorDBServiceRequestSchema,
  type CreateTailorDBTypeRequestSchema,
  type DeleteTailorDBGQLPermissionRequestSchema,
  type DeleteTailorDBServiceRequestSchema,
  type DeleteTailorDBTypeRequestSchema,
  type UpdateTailorDBGQLPermissionRequestSchema,
  type UpdateTailorDBTypeRequestSchema,
} from "@tailor-proto/tailor/v1/tailordb_pb";
import {
  TailorDBGQLPermission_Action,
  type TailorDBGQLPermission_ConditionSchema,
  type TailorDBGQLPermission_OperandSchema,
  TailorDBGQLPermission_Operator,
  TailorDBGQLPermission_Permit,
  type TailorDBGQLPermission_PolicySchema,
  type TailorDBGQLPermissionSchema,
  type TailorDBType as ProtoTailorDBType,
  type TailorDBType_FieldConfigSchema,
  type TailorDBType_FileConfigSchema,
  type TailorDBType_IndexSchema,
  type TailorDBType_Permission_ConditionSchema,
  type TailorDBType_Permission_OperandSchema,
  TailorDBType_Permission_Operator,
  TailorDBType_Permission_Permit,
  type TailorDBType_Permission_PolicySchema,
  type TailorDBType_PermissionSchema,
  TailorDBType_PermitAction,
  type TailorDBType_RelationshipConfigSchema,
  type TailorDBTypeSchema,
} from "@tailor-proto/tailor/v1/tailordb_resource_pb";
import * as inflection from "inflection";
import * as path from "pathe";
import {
  getNamespacesWithMigrations,
  type NamespaceWithMigrations,
} from "@/cli/commands/tailordb/migrate/config";
import {
  hasChanges,
  formatMigrationDiff,
  formatDiffSummary,
  type MigrationDiff,
} from "@/cli/commands/tailordb/migrate/diff-calculator";
import {
  applyPreMigrationFieldAdjustments,
  buildPreMigrationChangesMap,
} from "@/cli/commands/tailordb/migrate/pre-migration-schema";
import {
  reconstructSnapshotFromMigrations,
  compareLocalTypesWithSnapshot,
  assertValidMigrationFiles,
  formatMigrationNumber,
  compareRemoteWithSnapshot,
  formatSchemaDrifts,
  createSnapshotType,
  getLatestMigrationNumber,
  isSnapshotFieldRefOperand,
  type SnapshotFieldConfig,
  type TailorDBSnapshotType,
  type SnapshotRecordPermission,
  type SnapshotActionPermission,
  type SnapshotPermissionCondition,
  type SnapshotPermissionOperand,
  type SnapshotGqlPermission,
  type SnapshotGqlPermissionPolicy,
} from "@/cli/commands/tailordb/migrate/snapshot";
import { type TailorDBService } from "@/cli/services/tailordb/service";
import { fetchAll, type OperatorClient } from "@/cli/shared/client";
import { logger } from "@/cli/shared/logger";
import { createChangeSet, type HasName, type ChangeSet } from "../change-set";
import { areNormalizedEqual, normalizeProtoConfig } from "../compare";
import { ACTION_SYMBOLS, type DisplayAction, type GroupedDisplayEntry } from "../grouped-display";
import {
  buildMetaRequest,
  hasMatchingSdkVersion,
  isOwnedByApp,
  sdkNameLabelKey,
  trnPrefix,
  type WithLabel,
} from "../label";
import {
  executeMigrations,
  detectPendingMigrations,
  updateMigrationLabel,
  type MigrationContext,
} from "./migration";
import type { OwnerConflict, UnmanagedResource } from "../confirm";
import type { ApplyPhase, PlanContext } from "../deploy";
import type {
  PendingMigration,
  RemoteSchemaVerificationResult,
} from "@/cli/commands/tailordb/migrate/types";
import type { LoadedConfig } from "@/cli/shared/config-loader";
import type { Executor } from "@/types/executor.generated";
import type { GqlOperations, TailorDBServiceConfig } from "@/types/tailordb.generated";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

// ============================================================================
// Remote Schema Verification
// ============================================================================

/**
 * Fetch all TailorDB types from remote for a namespace
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {string} namespace - TailorDB namespace
 * @returns {Promise<ProtoTailorDBType[]>} Remote TailorDB types
 */
async function fetchRemoteTypes(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
): Promise<ProtoTailorDBType[]> {
  return fetchAll(async (pageToken, maxPageSize) => {
    try {
      const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes({
        workspaceId,
        namespaceName: namespace,
        pageToken,
        pageSize: maxPageSize,
      });
      return [tailordbTypes, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });
}

/**
 * Get the current migration number from remote metadata
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {string} namespace - TailorDB namespace
 * @returns {Promise<number | null>} Current migration number, or null if no migration label exists
 */
async function getRemoteMigrationNumber(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
): Promise<number | null> {
  try {
    const trn = `${trnPrefix(workspaceId)}:tailordb:${namespace}`;
    const { metadata } = await client.getMetadata({ trn });
    const label = metadata?.labels?.["sdk-migration"];
    if (!label) return null; // No migration label means first apply
    const match = label.match(/^m(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

/**
 * Verify remote schema matches the expected snapshot state
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {NamespaceWithMigrations[]} namespacesWithMigrations - Namespaces with migration config
 * @returns {Promise<RemoteSchemaVerificationResult[]>} Verification results per namespace
 */
async function verifyRemoteSchema(
  client: OperatorClient,
  workspaceId: string,
  namespacesWithMigrations: NamespaceWithMigrations[],
): Promise<RemoteSchemaVerificationResult[]> {
  const results: RemoteSchemaVerificationResult[] = [];

  for (const { namespace, migrationsDir } of namespacesWithMigrations) {
    // Get current remote migration number
    const remoteMigrationNumber = await getRemoteMigrationNumber(client, workspaceId, namespace);

    // If no migration label exists, this is likely a first apply - skip verification
    // Remote verification only makes sense when there's an established migration history
    if (remoteMigrationNumber === null) {
      results.push({
        namespace,
        remoteMigrationNumber: 0,
        drifts: [],
        hasDrift: false,
      });
      continue;
    }

    // Reconstruct snapshot at the remote migration version
    const expectedSnapshot = reconstructSnapshotFromMigrations(
      migrationsDir,
      remoteMigrationNumber,
    );
    if (!expectedSnapshot) {
      // No snapshots exist - skip verification
      results.push({
        namespace,
        remoteMigrationNumber,
        drifts: [],
        hasDrift: false,
      });
      continue;
    }

    // Fetch remote types
    const remoteTypes = await fetchRemoteTypes(client, workspaceId, namespace);

    // Compare remote with expected snapshot
    const drifts = compareRemoteWithSnapshot(remoteTypes, expectedSnapshot);

    results.push({
      namespace,
      remoteMigrationNumber,
      drifts,
      hasDrift: drifts.length > 0,
    });
  }

  return results;
}

/**
 * Format remote schema verification results for display
 * @param {RemoteSchemaVerificationResult[]} results - Verification results
 * @returns {string} Formatted results string
 */
function formatRemoteVerificationResults(results: RemoteSchemaVerificationResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    if (!result.hasDrift) continue;

    lines.push(`Namespace: ${result.namespace}`);
    lines.push(`  Remote migration: ${formatMigrationNumber(result.remoteMigrationNumber)}`);
    lines.push(`  Differences:`);
    lines.push(formatSchemaDrifts(result.drifts));
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Migration Validation
// ============================================================================

type ValidateAndDetectResult = {
  pendingMigrations: PendingMigration[];
  namespacesWithMigrations: NamespaceWithMigrations[];
};

/**
 * Validate migration files and detect pending migrations
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {ReadonlyMap<string, Record<string, TailorDBSnapshotType>>} typesByNamespace - Types by namespace
 * @param {LoadedConfig} config - Loaded application config (includes path)
 * @param {boolean} noSchemaCheck - Whether to skip schema diff check
 * @returns {Promise<ValidateAndDetectResult>} Pending migrations and namespaces that have migration directories configured
 */
async function validateAndDetectMigrations(
  client: OperatorClient,
  workspaceId: string,
  typesByNamespace: ReadonlyMap<string, Record<string, TailorDBSnapshotType>>,
  config: LoadedConfig,
  noSchemaCheck: boolean,
): Promise<ValidateAndDetectResult> {
  const configDir = path.dirname(config.path);
  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);
  let pendingMigrations: PendingMigration[] = [];

  if (namespacesWithMigrations.length > 0) {
    // Validate migration file integrity (sequential numbers, no gaps, no duplicates)
    for (const { namespace, migrationsDir } of namespacesWithMigrations) {
      assertValidMigrationFiles(migrationsDir, namespace);
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
        logger.info("Run 'tailor-sdk tailordb migration generate' to create migration files.");
        logger.info("Or use '--no-schema-check' to skip this check.");
        throw new Error("Schema migration check failed");
      }

      // 2. Check remote schema vs local snapshot (new check)
      const remoteVerificationResults = await verifyRemoteSchema(
        client,
        workspaceId,
        namespacesWithMigrations,
      );
      const hasRemoteDrift = remoteVerificationResults.some((r) => r.hasDrift);

      if (hasRemoteDrift) {
        logger.error("Remote schema drift detected:");
        logger.log(formatRemoteVerificationResults(remoteVerificationResults));
        logger.newline();
        logger.info("This may indicate:");
        logger.info("  - Another developer applied different migrations", { mode: "plain" });
        logger.info("  - Manual schema changes were made directly", { mode: "plain" });
        logger.info("  - Migration history is out of sync", { mode: "plain" });
        logger.newline();
        logger.info("Use '--no-schema-check' to skip this check (not recommended).");
        throw new Error("Remote schema verification failed");
      }
    }

    // Detect pending migrations (migration scripts that haven't been executed yet)
    pendingMigrations = await detectPendingMigrations(
      client,
      workspaceId,
      namespacesWithMigrations,
    );

    if (pendingMigrations.length > 0) {
      logger.newline();

      // Classify migrations by whether a migrate.ts will run for them.
      const withScripts = pendingMigrations.filter((m) => m.hasScript);
      const withoutScripts = pendingMigrations.filter((m) => !m.hasScript);

      logger.info(`Applying ${pendingMigrations.length} migration(s):`);
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

  return { pendingMigrations, namespacesWithMigrations };
}

/**
 * Reconcile the on-remote migration label with the working tree's latest
 * migration number for each namespace.
 *
 * Used after a `--no-schema-check` apply: that flag skips the local/remote
 * snapshot drift checks, but if it also leaves the label untouched the remote
 * label can drift past the working tree's latest migration (e.g. when
 * checking out an older revision and re-deploying). A subsequent run would
 * then reconstruct the expected snapshot at a label that no longer exists in
 * the working tree, triggering a false drift error.
 *
 * Always force `label = working_tree_max` regardless of the previous label so
 * the invariant `label <= working_tree_max` is preserved.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param namespacesWithMigrations - Namespaces that have migration directories configured
 */
async function reconcileMigrationLabels(
  client: OperatorClient,
  workspaceId: string,
  namespacesWithMigrations: NamespaceWithMigrations[],
): Promise<void> {
  for (const { namespace, migrationsDir } of namespacesWithMigrations) {
    const targetVersion = getLatestMigrationNumber(migrationsDir);
    const currentVersion = await getRemoteMigrationNumber(client, workspaceId, namespace);
    await updateMigrationLabel(client, workspaceId, namespace, targetVersion);
    if (currentVersion !== targetVersion) {
      const from = currentVersion === null ? "<unset>" : formatMigrationNumber(currentVersion);
      logger.info(
        `Migration label for namespace ${namespace} reconciled: ${from} → ${formatMigrationNumber(targetVersion)}.`,
      );
    }
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
  };
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
    // Validate and detect migrations
    // Build types by namespace map (snapshot-shaped, the canonical deploy form)
    const typesByNamespace = new Map<string, Record<string, TailorDBSnapshotType>>();
    for (const tailordb of migrationContext.tailorDBInputs) {
      typesByNamespace.set(tailordb.namespace, tailordb.types);
    }

    const { pendingMigrations, namespacesWithMigrations } = await validateAndDetectMigrations(
      client,
      migrationContext.workspaceId,
      typesByNamespace,
      migrationContext.config,
      migrationContext.noSchemaCheck,
    );

    if (pendingMigrations.length > 0) {
      // Migration flow: Execute each migration sequentially (pre -> script -> post)
      // This ensures intermediate states are properly handled when scripts depend on them

      // Reset tracking state for this migration run
      processedTypes.reset();
      deletedResources.reset();

      // Step 1: Create/update services once at the beginning (services don't need per-migration handling)
      await executeServicesCreation(client, changeSet);

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
        // Pre-migration phase: Create/update types with breaking fields as optional
        await executeSingleMigrationPrePhase(client, changeSet, migration);

        // Script execution (only if migrate.ts exists for this migration)
        if (migration.hasScript && migrationCtx) {
          await executeMigrations(migrationCtx, [migration]);
        }

        // Post-migration phase: Apply final types (required: true) and deletions
        await executeSingleMigrationPostPhase(client, changeSet, migration);

        // Update migration label only after all phases complete successfully
        await updateMigrationLabel(
          client,
          migrationContext.workspaceId,
          migration.namespace,
          migration.number,
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
    } else {
      // Normal create-update flow without migrations
      // Services
      await Promise.all([
        ...changeSet.service.creates.map(async (create) => {
          await client.createTailorDBService(create.request);
          await client.setMetadata(create.metaRequest);
        }),
        ...changeSet.service.updates.map((update) => client.setMetadata(update.metaRequest)),
      ]);

      // Types
      try {
        await Promise.all([
          ...changeSet.type.creates.map((create) => client.createTailorDBType(create.request)),
          ...changeSet.type.updates.map((update) => client.updateTailorDBType(update.request)),
        ]);
      } catch (error) {
        handleOptionalToRequiredError(error, [
          "Run 'tailor-sdk tailordb migration generate' to create migration files.",
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

    // When schema checks are skipped, force-reconcile the migration label so
    // that the invariant `label <= working_tree_max` always holds. Without
    // this, a `--no-schema-check` deploy from an older revision can leave a
    // stale label that breaks the next snapshot reconstruction (see
    // verifyRemoteSchema).
    if (migrationContext.noSchemaCheck && namespacesWithMigrations.length > 0) {
      await reconcileMigrationLabels(
        client,
        migrationContext.workspaceId,
        namespacesWithMigrations,
      );
    }
  } else if (phase === "delete-resources") {
    // Delete GQL permissions first, then types
    await Promise.all(
      changeSet.gqlPermission.deletes.map((del) => client.deleteTailorDBGQLPermission(del.request)),
    );
    await Promise.all(changeSet.type.deletes.map((del) => client.deleteTailorDBType(del.request)));
  } else if (phase === "delete-services") {
    // Services only
    await Promise.all(
      changeSet.service.deletes.map((del) => client.deleteTailorDBService(del.request)),
    );
  }
}

// ============================================================================
// Error Handling Helpers
// ============================================================================

/**
 * Handle optional-to-required field change error with helpful message
 * @param {unknown} error - Error to handle
 * @param {string[]} messages - Additional messages to display
 */
function handleOptionalToRequiredError(error: unknown, messages: string[]): never {
  if (
    error instanceof ConnectError &&
    error.code === Code.FailedPrecondition &&
    error.message.includes("cannot be updated from non-required to required when records exist")
  ) {
    logger.error(
      "Schema change failed: Cannot change field from optional to required when records exist.",
    );
    logger.newline();
    for (const message of messages) {
      logger.info(message);
    }
  }
  throw error;
}

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
      await client.setMetadata(create.metaRequest);
    }),
    ...changeSet.service.updates.map((update) => client.setMetadata(update.metaRequest)),
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
 * Execute pre-migration phase for a single migration
 * @param {OperatorClient} client - Operator client instance
 * @param {TailorDBChangeSet} changeSet - TailorDB change set
 * @param {PendingMigration} migration - Single pending migration
 * @returns {Promise<void>} Promise that resolves when pre-migration phase completes
 */
async function executeSingleMigrationPrePhase(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  migration: PendingMigration,
): Promise<void> {
  // Build pre-migration changes map for this single migration. Includes both
  // breaking changes (required-add, unique-add, enum value removal) and the
  // warning-tier field_removed, since the Pre-phase relaxes both.
  const preMigrationChanges = buildPreMigrationChangesMap([migration]);
  const affectedTypes = getAffectedTypeNames(migration);
  const createdBeforeMigration = new Set(processedTypes.created);

  // Types - create/update only types affected by this migration
  await Promise.all([
    // Create types that are affected by this migration and haven't been created yet
    ...changeSet.type.creates
      .filter((create) => {
        const typeName = create.request.tailordbType?.name;
        return typeName && affectedTypes.has(typeName) && !createdBeforeMigration.has(typeName);
      })
      .map((create) => {
        const typeName = create.request.tailordbType?.name;
        if (typeName) processedTypes.created.add(typeName);

        const typeChanges = typeName ? preMigrationChanges.get(typeName) : undefined;

        if (!typeChanges || typeChanges.size === 0) {
          return client.createTailorDBType(create.request);
        }

        // Clone request to avoid modifying the original changeSet
        const clonedRequest = structuredClone(create.request);
        if (clonedRequest.tailordbType?.schema?.fields) {
          applyPreMigrationFieldAdjustments(clonedRequest.tailordbType.schema.fields, typeChanges);
        }

        return client.createTailorDBType(clonedRequest);
      }),
    // Update types already created in previous migrations (from create list)
    ...changeSet.type.creates
      .filter((create) => {
        const typeName = create.request.tailordbType?.name;
        return typeName && affectedTypes.has(typeName) && createdBeforeMigration.has(typeName);
      })
      .map((create) => {
        const typeName = create.request.tailordbType?.name;
        if (typeName) processedTypes.updated.add(typeName);

        const typeChanges = typeName ? preMigrationChanges.get(typeName) : undefined;

        if (!typeChanges || typeChanges.size === 0) {
          return client.updateTailorDBType({
            workspaceId: create.request.workspaceId,
            namespaceName: create.request.namespaceName,
            tailordbType: create.request.tailordbType,
          });
        }

        const clonedRequest = structuredClone(create.request);
        if (clonedRequest.tailordbType?.schema?.fields) {
          applyPreMigrationFieldAdjustments(clonedRequest.tailordbType.schema.fields, typeChanges);
        }

        return client.updateTailorDBType({
          workspaceId: create.request.workspaceId,
          namespaceName: create.request.namespaceName,
          tailordbType: clonedRequest.tailordbType,
        });
      }),
    // Update types that are affected by this migration
    ...changeSet.type.updates
      .filter((update) => {
        const typeName = update.request.tailordbType?.name;
        return typeName && affectedTypes.has(typeName);
      })
      .map((update) => {
        const typeName = update.request.tailordbType?.name;
        if (typeName) processedTypes.updated.add(typeName);

        const typeChanges = typeName ? preMigrationChanges.get(typeName) : undefined;

        if (!typeChanges || typeChanges.size === 0) {
          return client.updateTailorDBType(update.request);
        }

        // Clone request to avoid modifying the original changeSet
        const clonedRequest = structuredClone(update.request);
        if (clonedRequest.tailordbType?.schema?.fields) {
          applyPreMigrationFieldAdjustments(clonedRequest.tailordbType.schema.fields, typeChanges);
        }

        return client.updateTailorDBType(clonedRequest);
      }),
  ]);

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
      await Promise.all(
        missingTypeCreates.map((create) => {
          const typeName = create.request.tailordbType?.name;
          if (typeName) processedTypes.created.add(typeName);
          return client.createTailorDBType(create.request);
        }),
      );
    }
    processedTypes.gqlPermissionsProcessed.add(migration.namespace);
    await Promise.all([
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
 * @returns {Promise<void>} Promise that resolves when post-migration phase completes
 */
async function executeSingleMigrationPostPhase(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  migration: PendingMigration,
): Promise<void> {
  // Re-use the pre-migration changes map to know which types were touched in
  // this migration (so we send the post-phase final-schema update for them).
  const preMigrationChanges = buildPreMigrationChangesMap([migration]);
  const affectedTypes = getAffectedTypeNames(migration);
  const deletedTypeNames = getDeletedTypeNames(migration);

  // Types - apply final schema values for types affected by this migration
  // Pre-migration used cloned requests, so the original changeSet still has correct values
  try {
    await Promise.all([
      // For newly created types that had pre-migration adjustments in this migration, send update with final values
      ...changeSet.type.creates
        .filter((create) => {
          const typeName = create.request.tailordbType?.name;
          return typeName && affectedTypes.has(typeName) && preMigrationChanges.has(typeName);
        })
        .map((create) =>
          client.updateTailorDBType({
            workspaceId: create.request.workspaceId,
            namespaceName: create.request.namespaceName,
            tailordbType: create.request.tailordbType,
          }),
        ),
      // For updated types affected by this migration, send update with final values
      ...changeSet.type.updates
        .filter((update) => {
          const typeName = update.request.tailordbType?.name;
          return typeName && affectedTypes.has(typeName) && preMigrationChanges.has(typeName);
        })
        .map((update) => client.updateTailorDBType(update.request)),
    ]);
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
 * Plan TailorDB-related changes based on current and desired state.
 * @param context - Planning context
 * @returns Planned changes
 */
/**
 * Canonical input shape consumed by every TailorDB plan/proto step.
 * The deploy pipeline funnels `TailorDBService` through `createSnapshotType` so
 * that comparison, manifest generation and migration drift checks all read the
 * same snapshot-shaped data, keeping platform-side normalization (e.g. decimal
 * scale) in one place.
 */
type TailorDBDeployInput = {
  namespace: string;
  config: TailorDBServiceConfig;
  types: Record<string, TailorDBSnapshotType>;
};

/**
 * Convert a runtime TailorDBService to the snapshot-shaped deploy input.
 * @param service - Loaded TailorDB service (after `loadTypes()`)
 * @returns The canonical snapshot-shaped deploy input for downstream plan/apply phases.
 */
function toTailorDBDeployInput(service: TailorDBService): TailorDBDeployInput {
  const types: Record<string, TailorDBSnapshotType> = {};
  for (const [typeName, type] of Object.entries(service.types)) {
    types[typeName] = createSnapshotType(type);
  }
  return {
    namespace: service.namespace,
    config: service.config,
    types,
  };
}

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

  const {
    changeSet: serviceChangeSet,
    conflicts,
    unmanaged,
    resourceOwners,
  } = await planServices(client, workspaceId, application.name, application.id, tailordbs);
  const deletedServices = serviceChangeSet.deletes.map((del) => del.name);
  const [typeChangeSet, gqlPermissionChangeSet] = await Promise.all([
    planTypes(client, workspaceId, tailordbs, executors, deletedServices, undefined, forceApplyAll),
    planGqlPermissions(client, workspaceId, tailordbs, deletedServices, forceApplyAll),
  ]);

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
      config,
      noSchemaCheck: noSchemaCheck ?? false,
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
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateService = {
  name: string;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBServiceRequestSchema>;
};

function trn(workspaceId: string, name: string) {
  return `${trnPrefix(workspaceId)}:tailordb:${name}`;
}

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

  const withoutLabel = await fetchAll(async (pageToken, maxPageSize) => {
    try {
      const { tailordbServices, nextPageToken } = await client.listTailorDBServices({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [tailordbServices, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });
  const existingServices: WithLabel<(typeof withoutLabel)[number]> = {};
  await Promise.all(
    withoutLabel.map(async (resource) => {
      if (!resource.namespace?.name) {
        return;
      }
      const { metadata } = await client.getMetadata({
        trn: trn(workspaceId, resource.namespace.name),
      });
      existingServices[resource.namespace.name] = {
        resource,
        label: metadata?.labels[sdkNameLabelKey],
        allLabels: metadata?.labels,
      };
    }),
  );

  for (const tailordb of tailordbs) {
    const existing = existingServices[tailordb.namespace];
    const metaRequest = await buildMetaRequest({
      trn: trn(workspaceId, tailordb.namespace),
      appName,
      appId,
      existingLabels: existing?.allLabels,
    });
    if (existing) {
      const owned = isOwnedByApp(existing.allLabels, appName, appId);
      if (!owned) {
        if (!existing.label) {
          unmanaged.push({
            resourceType: "TailorDB service",
            resourceName: tailordb.namespace,
          });
        } else {
          conflicts.push({
            resourceType: "TailorDB service",
            resourceName: tailordb.namespace,
            currentOwner: existing.label,
          });
        }
      }

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
          // Set UTC to match tailorctl/terraform
          defaultTimezone: "UTC",
        },
        metaRequest,
      });
    }
  }
  Object.entries(existingServices).forEach(([namespaceName]) => {
    const entry = existingServices[namespaceName];
    const label = entry?.label;
    const owned = isOwnedByApp(entry?.allLabels, appName, appId);
    if (label && !owned) {
      resourceOwners.add(label);
    }
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
};

type UpdateType = {
  name: string;
  request: MessageInitShape<typeof UpdateTailorDBTypeRequestSchema>;
};

type DeleteType = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBTypeRequestSchema>;
};

async function planTypes(
  client: OperatorClient,
  workspaceId: string,
  tailordbs: ReadonlyArray<TailorDBDeployInput>,
  executors: ReadonlyArray<Executor>,
  deletedServices: ReadonlyArray<string>,
  filteredTypesByNamespace?: Map<string, Record<string, TailorDBSnapshotType>>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateType, UpdateType, DeleteType>("TailorDB types");

  const fetchTypes = (namespaceName: string) => {
    return fetchAll(async (pageToken, maxPageSize) => {
      try {
        const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes({
          workspaceId,
          namespaceName,
          pageToken,
          pageSize: maxPageSize,
        });
        return [tailordbTypes, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });
  };

  const executorUsedTypes = new Set<string>();
  for (const executor of executors) {
    if (executor.trigger.kind === "tailordb") {
      executorUsedTypes.add(executor.trigger.typeName);
    }
  }

  // Validate that types used by executors don't have publishEvents explicitly set to false
  for (const tailordb of tailordbs) {
    const types = filteredTypesByNamespace?.get(tailordb.namespace) ?? tailordb.types;
    for (const typeName of Object.keys(types)) {
      const type = types[typeName];
      if (executorUsedTypes.has(typeName) && type.settings?.publishEvents === false) {
        throw new Error(
          `Type "${typeName}" has publishEvents set to false, but it is used by an executor with a record trigger. ` +
            `Either remove the publishEvents: false setting or remove the executor trigger for this type.`,
        );
      }
    }
  }

  for (const tailordb of tailordbs) {
    const existingTypes = await fetchTypes(tailordb.namespace);
    const existingTypesMap = new Map(existingTypes.map((type) => [type.name, type]));

    // Use filtered types if provided, otherwise use local types
    const types = filteredTypesByNamespace?.get(tailordb.namespace) ?? tailordb.types;

    for (const typeName of Object.keys(types)) {
      const tailordbType = generateTailorDBTypeManifest(
        types[typeName],
        executorUsedTypes,
        tailordb.config.gqlOperations,
      );
      const existingType = existingTypesMap.get(typeName);
      if (existingType) {
        if (
          !forceApplyAll &&
          areNormalizedEqual(
            normalizeComparableTailorDBType(existingType),
            normalizeComparableTailorDBType(tailordbType),
          )
        ) {
          changeSet.unchanged.push({ name: typeName });
        } else {
          changeSet.updates.push({
            name: typeName,
            request: {
              workspaceId,
              namespaceName: tailordb.namespace,
              tailordbType,
            },
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

function normalizeComparableTailorDBType(type: unknown) {
  const normalized = normalizeProtoConfig(type) as {
    name?: string;
    schema?: {
      description?: string;
      fields?: Record<string, unknown>;
      relationships?: Record<string, unknown>;
      settings?: Record<string, unknown>;
      indexes?: Record<string, unknown>;
      files?: Record<string, unknown>;
      permission?: Record<string, unknown>;
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
      },
    },
    [],
  );
}

function normalizeTailorDBCompareValue(
  value: unknown,
  path: readonly (string | number)[],
): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
    if (matchesNumericStringPath(path) && isNumericLikeValue(value)) {
      return String(value);
    }
    if (path.at(-1) === "expr" && value === tailordbCompareKnownDefaults.emptyExpression) {
      return undefined;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item, index) => normalizeTailorDBCompareValue(item, [...path, index]))
      .filter((item) => item !== undefined);
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
    areNormalizedEqual(normalizedObject, tailordbCompareKnownDefaults.disableGqlOperations)
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

// TODO(remiposo): Copied the type-processor / aggregator processing almost as-is.
// This will need refactoring later.
/**
 * Generate a TailorDB type manifest from snapshot-shaped type
 * @param {TailorDBSnapshotType} type - Snapshot-shaped TailorDB type
 * @param {ReadonlySet<string>} executorUsedTypes - Set of types used by executors
 * @param {GqlOperations} [namespaceGqlOperations] - Default gqlOperations for the namespace (already normalized)
 * @returns {MessageInitShape<typeof TailorDBTypeSchema>} Type manifest
 */
function generateTailorDBTypeManifest(
  type: TailorDBSnapshotType,
  executorUsedTypes: ReadonlySet<string>,
  namespaceGqlOperations?: GqlOperations,
): MessageInitShape<typeof TailorDBTypeSchema> {
  // Ensures that explicitly provided pluralForm like "PurchaseOrderList" becomes "purchaseOrderList".
  const pluralForm = inflection.camelize(type.pluralForm, true);

  const defaultSettings: {
    aggregation: boolean;
    bulkUpsert: boolean;
    draft: boolean;
    defaultQueryLimitSize: bigint;
    maxBulkUpsertSize: bigint;
    pluralForm: string;
    publishRecordEvents: boolean;
    disableGqlOperations?: {
      create: boolean;
      update: boolean;
      delete: boolean;
      read: boolean;
    };
  } = {
    aggregation: type.settings?.aggregation || false,
    bulkUpsert: type.settings?.bulkUpsert || false,
    draft: false,
    defaultQueryLimitSize: 100n,
    maxBulkUpsertSize: 1000n,
    pluralForm,
    publishRecordEvents: false,
  };

  // Determine publishRecordEvents (user-facing name: publishEvents):
  // - If user explicitly sets a value (true or false), respect that (validation already ensures no executor conflict)
  // - If not set, use executor detection (true if executor uses this type)
  if (type.settings?.publishEvents !== undefined) {
    defaultSettings.publishRecordEvents = type.settings.publishEvents;
  } else if (executorUsedTypes.has(type.name)) {
    defaultSettings.publishRecordEvents = true;
  }

  // Both type.settings.gqlOperations and namespaceGqlOperations are already normalized by schema
  const ops = type.settings?.gqlOperations ?? namespaceGqlOperations;
  if (ops) {
    defaultSettings.disableGqlOperations = {
      create: ops.create === false,
      update: ops.update === false,
      delete: ops.delete === false,
      read: ops.read === false,
    };
  }

  const fields: Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>> = {};

  Object.keys(type.fields)
    .filter((fieldName) => fieldName !== "id")
    .forEach((fieldName) => {
      const fieldConfig = type.fields[fieldName];
      const fieldType = fieldConfig.type;
      const fieldEntry: MessageInitShape<typeof TailorDBType_FieldConfigSchema> = {
        type: fieldType,
        allowedValues: fieldType === "enum" ? fieldConfig.allowedValues || [] : [],
        description: fieldConfig.description || "",
        validate: toProtoFieldValidate(fieldConfig),
        array: fieldConfig.array || false,
        index: fieldConfig.index || false,
        unique: fieldConfig.unique || false,
        foreignKey: fieldConfig.foreignKey || false,
        foreignKeyType: fieldConfig.foreignKeyType,
        foreignKeyField: fieldConfig.foreignKeyField,
        required: fieldConfig.required,
        vector: fieldConfig.vector || false,
        ...toProtoFieldHooks(fieldConfig),
        ...(fieldConfig.serial && {
          serial: {
            start: fieldConfig.serial.start as unknown as bigint,
            ...(fieldConfig.serial.maxValue && {
              maxValue: fieldConfig.serial.maxValue as unknown as bigint,
            }),
            ...(fieldConfig.serial.format && {
              format: fieldConfig.serial.format,
            }),
          },
        }),
        ...(fieldConfig.scale !== undefined && { scale: fieldConfig.scale }),
      };

      // Handle nested fields
      if (fieldConfig.type === "nested" && fieldConfig.fields) {
        fieldEntry.fields = processNestedFields(fieldConfig.fields);
      }

      fields[fieldName] = fieldEntry;
    });

  const relationships: Record<
    string,
    MessageInitShape<typeof TailorDBType_RelationshipConfigSchema>
  > = {};

  for (const [relationName, rel] of Object.entries(type.forwardRelationships ?? {})) {
    relationships[relationName] = {
      refType: rel.targetType,
      refField: rel.sourceField,
      srcField: rel.targetField,
      array: rel.isArray,
      description: rel.description,
    };
  }

  for (const [relationName, rel] of Object.entries(type.backwardRelationships ?? {})) {
    relationships[relationName] = {
      refType: rel.targetType,
      refField: rel.targetField,
      srcField: rel.sourceField,
      array: rel.isArray,
      description: rel.description,
    };
  }

  // Process indexes from metadata
  const indexes: Record<string, MessageInitShape<typeof TailorDBType_IndexSchema>> = {};
  if (type.indexes) {
    Object.entries(type.indexes).forEach(([key, index]) => {
      indexes[key] = {
        fieldNames: index.fields,
        unique: index.unique || false,
      };
    });
  }

  // Process files from metadata
  const files: Record<string, MessageInitShape<typeof TailorDBType_FileConfigSchema>> = {};
  if (type.files) {
    Object.entries(type.files).forEach(([key, description]) => {
      files[key] = { description: description || "" };
    });
  }

  // To be secure by default, add Permission settings that reject everyone
  // when Permission/RecordPermission is not configured.
  const defaultPermission: MessageInitShape<typeof TailorDBType_PermissionSchema> = {
    create: [],
    read: [],
    update: [],
    delete: [],
  };
  const permission = type.permissions?.record
    ? protoPermission(type.permissions.record)
    : defaultPermission;

  return {
    name: type.name,
    schema: {
      description: type.description || "",
      fields,
      relationships: relationships,
      settings: defaultSettings,
      extends: false,
      directives: [],
      indexes,
      files,
      permission,
    },
  };
}

function toProtoFieldValidate(
  fieldConfig: SnapshotFieldConfig,
): MessageInitShape<typeof TailorDBType_FieldConfigSchema>["validate"] {
  return (fieldConfig.validate || []).map((val) => ({
    action: TailorDBType_PermitAction.DENY,
    errorMessage: val.errorMessage || "",
    ...(val.script && {
      script: {
        expr: val.script.expr ? `!${val.script.expr}` : "",
      },
    }),
  }));
}

function toProtoFieldHooks(
  fieldConfig: SnapshotFieldConfig,
): Pick<MessageInitShape<typeof TailorDBType_FieldConfigSchema>, "hooks"> | Record<never, never> {
  if (!fieldConfig.hooks) {
    return {};
  }
  return {
    hooks: {
      create: fieldConfig.hooks.create
        ? {
            expr: fieldConfig.hooks.create.expr || "",
          }
        : undefined,
      update: fieldConfig.hooks.update
        ? {
            expr: fieldConfig.hooks.update.expr || "",
          }
        : undefined,
    },
  };
}

function processNestedFields(
  fields: Record<string, SnapshotFieldConfig>,
): Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>> {
  const nestedFields: Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>> = {};

  Object.entries(fields).forEach(([nestedFieldName, nestedFieldConfig]) => {
    const nestedType = nestedFieldConfig.type;

    if (nestedType === "nested" && nestedFieldConfig.fields) {
      const deepNestedFields = processNestedFields(nestedFieldConfig.fields);
      nestedFields[nestedFieldName] = {
        type: "nested",
        allowedValues: nestedFieldConfig.allowedValues || [],
        description: nestedFieldConfig.description || "",
        validate: toProtoFieldValidate(nestedFieldConfig),
        required: nestedFieldConfig.required,
        array: nestedFieldConfig.array ?? false,
        index: false,
        unique: false,
        foreignKey: false,
        vector: false,
        ...toProtoFieldHooks(nestedFieldConfig),
        fields: deepNestedFields,
        ...(nestedFieldConfig.scale !== undefined && {
          scale: nestedFieldConfig.scale,
        }),
      };
    } else {
      nestedFields[nestedFieldName] = {
        type: nestedType,
        allowedValues: nestedType === "enum" ? nestedFieldConfig.allowedValues || [] : [],
        description: nestedFieldConfig.description || "",
        validate: toProtoFieldValidate(nestedFieldConfig),
        required: nestedFieldConfig.required,
        array: nestedFieldConfig.array ?? false,
        index: false,
        unique: false,
        foreignKey: false,
        vector: false,
        ...toProtoFieldHooks(nestedFieldConfig),
        ...(nestedFieldConfig.serial && {
          serial: {
            start: nestedFieldConfig.serial.start as unknown as bigint,
            ...(nestedFieldConfig.serial.maxValue && {
              maxValue: nestedFieldConfig.serial.maxValue as unknown as bigint,
            }),
            ...(nestedFieldConfig.serial.format && {
              format: nestedFieldConfig.serial.format,
            }),
          },
        }),
        ...(nestedFieldConfig.scale !== undefined && {
          scale: nestedFieldConfig.scale,
        }),
      };
    }
  });

  return nestedFields;
}

function protoPermission(
  permission: SnapshotRecordPermission,
): MessageInitShape<typeof TailorDBType_PermissionSchema> {
  return {
    create: permission.create.map((policy) => protoPolicy(policy)),
    read: permission.read.map((policy) => protoPolicy(policy)),
    update: permission.update.map((policy) => protoPolicy(policy)),
    delete: permission.delete.map((policy) => protoPolicy(policy)),
  };
}

function protoPolicy(
  policy: SnapshotActionPermission,
): MessageInitShape<typeof TailorDBType_Permission_PolicySchema> {
  let permit: TailorDBType_Permission_Permit;
  switch (policy.permit) {
    case "allow":
      permit = TailorDBType_Permission_Permit.ALLOW;
      break;
    case "deny":
      permit = TailorDBType_Permission_Permit.DENY;
      break;
    default:
      throw new Error(`Unknown permission: ${policy.permit satisfies never}`);
  }
  return {
    conditions: policy.conditions.map((cond) => protoCondition(cond)),
    permit,
    description: policy.description,
  };
}

function protoCondition(
  condition: SnapshotPermissionCondition,
): MessageInitShape<typeof TailorDBType_Permission_ConditionSchema> {
  const [left, operator, right] = condition;

  const l = protoOperand(left);
  const r = protoOperand(right);
  let op: TailorDBType_Permission_Operator;
  switch (operator) {
    case "eq":
      op = TailorDBType_Permission_Operator.EQ;
      break;
    case "ne":
      op = TailorDBType_Permission_Operator.NE;
      break;
    case "in":
      op = TailorDBType_Permission_Operator.IN;
      break;
    case "nin":
      op = TailorDBType_Permission_Operator.NIN;
      break;
    case "hasAny":
      op = TailorDBType_Permission_Operator.HAS_ANY;
      break;
    case "nhasAny":
      op = TailorDBType_Permission_Operator.NHAS_ANY;
      break;
    default:
      throw new Error(`Unknown operator: ${operator satisfies never}`);
  }
  return {
    left: l,
    operator: op,
    right: r,
  };
}

function protoOperand(
  operand: SnapshotPermissionOperand,
): MessageInitShape<typeof TailorDBType_Permission_OperandSchema> {
  if (isSnapshotFieldRefOperand(operand)) {
    if ("user" in operand) {
      return { kind: { case: "userField", value: operand.user } };
    }
    if ("record" in operand) {
      return { kind: { case: "recordField", value: operand.record } };
    }
    if ("newRecord" in operand) {
      return { kind: { case: "newRecordField", value: operand.newRecord } };
    }
    if ("oldRecord" in operand) {
      return { kind: { case: "oldRecordField", value: operand.oldRecord } };
    }
    operand satisfies never;
    throw new Error(`Unknown field-ref operand shape: ${JSON.stringify(operand)}`);
  }

  return {
    kind: { case: "value", value: fromJson(ValueSchema, operand) },
  };
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
    return fetchAll(async (pageToken, maxPageSize) => {
      try {
        const { permissions, nextPageToken } = await client.listTailorDBGQLPermissions({
          workspaceId,
          namespaceName,
          pageToken,
          pageSize: maxPageSize,
        });
        return [permissions, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });
  };

  for (const tailordb of tailordbs) {
    const existingGqlPermissions = await fetchGqlPermissions(tailordb.namespace);
    const existingNameSet = new Set<string>();
    existingGqlPermissions.forEach((gqlPermission) => {
      existingNameSet.add(gqlPermission.typeName);
    });

    const types = tailordb.types;
    for (const typeName of Object.keys(types)) {
      const gqlPermission = types[typeName].permissions?.gql;
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
      actions: [...(policy.actions ?? [])].sort((left, right) => left - right),
    })),
  };
}

function protoGqlPermission(
  permission: SnapshotGqlPermission,
): MessageInitShape<typeof TailorDBGQLPermissionSchema> {
  return {
    policies: permission.map((policy) => protoGqlPolicy(policy)),
  };
}

function protoGqlPolicy(
  policy: SnapshotGqlPermissionPolicy,
): MessageInitShape<typeof TailorDBGQLPermission_PolicySchema> {
  const actions: TailorDBGQLPermission_Action[] = [];
  for (const action of policy.actions) {
    switch (action) {
      case "all":
        actions.push(TailorDBGQLPermission_Action.ALL);
        break;
      case "create":
        actions.push(TailorDBGQLPermission_Action.CREATE);
        break;
      case "read":
        actions.push(TailorDBGQLPermission_Action.READ);
        break;
      case "update":
        actions.push(TailorDBGQLPermission_Action.UPDATE);
        break;
      case "delete":
        actions.push(TailorDBGQLPermission_Action.DELETE);
        break;
      case "aggregate":
        actions.push(TailorDBGQLPermission_Action.AGGREGATE);
        break;
      case "bulkUpsert":
        actions.push(TailorDBGQLPermission_Action.BULK_UPSERT);
        break;
      default:
        throw new Error(`Unknown action: ${action satisfies never}`);
    }
  }
  let permit: TailorDBGQLPermission_Permit;
  switch (policy.permit) {
    case "allow":
      permit = TailorDBGQLPermission_Permit.ALLOW;
      break;
    case "deny":
      permit = TailorDBGQLPermission_Permit.DENY;
      break;
    default:
      throw new Error(`Unknown permission: ${policy.permit satisfies never}`);
  }
  return {
    conditions: policy.conditions.map((cond) => protoGqlCondition(cond)),
    actions,
    permit,
    description: policy.description,
  };
}

function protoGqlCondition(
  condition: SnapshotPermissionCondition,
): MessageInitShape<typeof TailorDBGQLPermission_ConditionSchema> {
  const [left, operator, right] = condition;

  const l = protoGqlOperand(left);
  const r = protoGqlOperand(right);
  let op: TailorDBGQLPermission_Operator;
  switch (operator) {
    case "eq":
      op = TailorDBGQLPermission_Operator.EQ;
      break;
    case "ne":
      op = TailorDBGQLPermission_Operator.NE;
      break;
    case "in":
      op = TailorDBGQLPermission_Operator.IN;
      break;
    case "nin":
      op = TailorDBGQLPermission_Operator.NIN;
      break;
    case "hasAny":
      op = TailorDBGQLPermission_Operator.HAS_ANY;
      break;
    case "nhasAny":
      op = TailorDBGQLPermission_Operator.NHAS_ANY;
      break;
    default:
      throw new Error(`Unknown operator: ${operator satisfies never}`);
  }
  return {
    left: l,
    operator: op,
    right: r,
  };
}

function protoGqlOperand(
  operand: SnapshotPermissionOperand,
): MessageInitShape<typeof TailorDBGQLPermission_OperandSchema> {
  if (isSnapshotFieldRefOperand(operand)) {
    if ("user" in operand) {
      return { kind: { case: "userField", value: operand.user } };
    }
    throw new Error(
      `Unsupported field-ref operand in GQL permission: ${JSON.stringify(operand)} ` +
        `— GQL permissions only support { user } field references`,
    );
  }

  return {
    kind: { case: "value", value: fromJson(ValueSchema, operand) },
  };
}

// ============================================================================
// Migration Integration
// ============================================================================

interface MigrationCheckResult {
  namespace: string;
  migrationsDir: string;
  hasDiff: boolean;
  diff?: MigrationDiff;
}

/**
 * Check if there are schema differences between migration snapshots and local definitions
 * @param {ReadonlyMap<string, Record<string, TailorDBSnapshotType>>} typesByNamespace - Snapshot-shaped local types by namespace
 * @param {NamespaceWithMigrations[]} namespacesWithMigrations - Namespaces with migrations config
 * @returns {Promise<MigrationCheckResult[]>} Results for each namespace
 */
async function checkMigrationDiffs(
  typesByNamespace: ReadonlyMap<string, Record<string, TailorDBSnapshotType>>,
  namespacesWithMigrations: NamespaceWithMigrations[],
): Promise<MigrationCheckResult[]> {
  const results: MigrationCheckResult[] = [];

  for (const { namespace, migrationsDir } of namespacesWithMigrations) {
    const localTypes = typesByNamespace.get(namespace);
    if (!localTypes) {
      continue;
    }

    // Try to reconstruct snapshot from migrations
    let previousSnapshot;
    try {
      previousSnapshot = reconstructSnapshotFromMigrations(migrationsDir);
    } catch {
      // No migrations directory - this is fine, no check needed
      results.push({
        namespace,
        migrationsDir,
        hasDiff: false,
      });
      continue;
    }

    if (!previousSnapshot) {
      // No snapshots yet - user should run migrate generate first
      results.push({
        namespace,
        migrationsDir,
        hasDiff: true,
        diff: undefined, // Indicates no snapshot exists
      });
      continue;
    }

    // Compare with local types
    const diff = compareLocalTypesWithSnapshot(previousSnapshot, localTypes, namespace);

    results.push({
      namespace,
      migrationsDir,
      hasDiff: hasChanges(diff),
      diff: hasChanges(diff) ? diff : undefined,
    });
  }

  return results;
}

/**
 * Format migration check results for display
 * @param {MigrationCheckResult[]} results - Migration check results
 * @returns {string} Formatted results string
 */
function formatMigrationCheckResults(results: MigrationCheckResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    if (!result.hasDiff) {
      continue;
    }

    lines.push(`Namespace: ${result.namespace}`);

    if (!result.diff) {
      lines.push(
        "  No migration snapshot found. Run 'tailor-sdk tailordb migration generate' first.",
      );
    } else {
      lines.push(`  ${formatDiffSummary(result.diff)}`);
      lines.push("");
      lines.push(formatMigrationDiff(result.diff));
    }
    lines.push("");
  }

  return lines.join("\n");
}
