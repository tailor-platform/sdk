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
  type DiffChange,
} from "@/cli/commands/tailordb/migrate/diff-calculator";
import {
  reconstructSnapshotFromMigrations,
  compareLocalTypesWithSnapshot,
  assertValidMigrationFiles,
  formatMigrationNumber,
  compareRemoteWithSnapshot,
  formatSchemaDrifts,
} from "@/cli/commands/tailordb/migrate/snapshot";
import { type TailorDBService } from "@/cli/services/tailordb/service";
import { fetchAll, type OperatorClient } from "@/cli/shared/client";
import { logger, styles } from "@/cli/shared/logger";
import { createChangeSet, type HasName, type ChangeSet } from "../change-set";
import {
  areNormalizedEqual,
  formatPropertyDiffLines,
  isPlainObject,
  normalizeProtoConfig,
} from "../compare";
import {
  actionSymbol,
  formatActionDetailLine,
  type DisplayAction,
  type GroupedDisplayEntry,
} from "../grouped-display";
import {
  buildMetaRequest,
  hasMatchingSdkVersion,
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
import type { ApplyPhase, PlanContext } from "../apply";
import type { OwnerConflict, UnmanagedResource } from "../confirm";
import type {
  PendingMigration,
  RemoteSchemaVerificationResult,
} from "@/cli/commands/tailordb/migrate/types";
import type { LoadedConfig } from "@/cli/shared/config-loader";
import type { Executor } from "@/types/executor.generated";
import type {
  EnumValue,
  PermissionOperand,
  StandardActionPermission,
  StandardGqlPermissionPolicy,
  StandardPermissionCondition,
  StandardTailorTypeGqlPermission,
  StandardTailorTypePermission,
  OperatorFieldConfig,
  TailorDBType,
} from "@/types/tailordb";
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

/**
 * Validate migration files and detect pending migrations
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {ReadonlyMap<string, Record<string, TailorDBType>>} typesByNamespace - Types by namespace
 * @param {LoadedConfig} config - Loaded application config (includes path)
 * @param {boolean} noSchemaCheck - Whether to skip schema diff check
 * @returns {Promise<PendingMigration[]>} List of pending migrations
 */
async function validateAndDetectMigrations(
  client: OperatorClient,
  workspaceId: string,
  typesByNamespace: ReadonlyMap<string, Record<string, TailorDBType>>,
  config: LoadedConfig,
  noSchemaCheck: boolean,
): Promise<PendingMigration[]> {
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

      // Classify migrations by whether they require migration scripts
      const withScripts = pendingMigrations.filter((m) => m.diff.requiresMigrationScript);
      const withoutScripts = pendingMigrations.filter((m) => !m.diff.requiresMigrationScript);

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

  return pendingMigrations;
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
    // Build types by namespace map
    const typesByNamespace = new Map<string, Record<string, TailorDBType>>();
    for (const tailordb of migrationContext.application.tailorDBServices) {
      const types = tailordb.types;
      if (types) {
        typesByNamespace.set(tailordb.namespace, types);
      }
    }

    const pendingMigrations = await validateAndDetectMigrations(
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

      const migrationsRequiringScripts = pendingMigrations.filter(
        (m) => m.diff.requiresMigrationScript,
      );

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

        // Script execution (only if this migration requires a script)
        if (migration.diff.requiresMigrationScript && migrationCtx) {
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
// Pre-Migration Support
// ============================================================================

/**
 * Map of breaking changes: typeName -> fieldName -> change kind
 */
type BreakingChangesMap = Map<string, Map<string, DiffChange>>;

/**
 * Build a map of breaking field changes from pending migrations
 * @param {PendingMigration[]} pendingMigrations - Pending migrations
 * @returns {BreakingChangesMap} Map of breaking changes
 */
function buildBreakingChangesMap(pendingMigrations: PendingMigration[]): BreakingChangesMap {
  const map: BreakingChangesMap = new Map();

  for (const migration of pendingMigrations) {
    for (const change of migration.diff.changes) {
      // We care about field changes that affect required status
      if (
        change.kind === "field_added" ||
        change.kind === "field_modified" ||
        change.kind === "field_removed"
      ) {
        if (!change.fieldName) continue;

        if (!map.has(change.typeName)) {
          map.set(change.typeName, new Map());
        }
        map.get(change.typeName)!.set(change.fieldName, change);
      }
    }
  }

  return map;
}

/**
 * Field config type for breaking change detection
 */
interface FieldConfig {
  required?: boolean;
  unique?: boolean;
  allowedValues?: EnumValue[];
}

/**
 * Apply pre-migration schema adjustments to avoid breaking changes before scripts run.
 * @param fields - Field configs to adjust
 * @param typeChanges - Breaking changes for a type
 */
function applyPreMigrationFieldAdjustments(
  fields: Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>>,
  typeChanges: Map<string, DiffChange>,
): void {
  for (const [fieldName, change] of typeChanges) {
    const field = fields[fieldName];
    if (!field) continue;

    const before = change.before as FieldConfig | undefined;
    const after = change.after as FieldConfig | undefined;

    if (change.kind === "field_added" && after?.required) {
      field.required = false;
    }

    if (change.kind !== "field_modified") {
      continue;
    }

    // Optional to required
    if (!before?.required && after?.required) {
      field.required = false;
    }

    // Unique constraint added
    if (!(before?.unique ?? false) && (after?.unique ?? false)) {
      field.unique = false;
    }

    // Enum values removed: keep old values + add new values (union)
    if (before?.allowedValues && after?.allowedValues) {
      const afterValues = new Set(after.allowedValues.map((v) => v.value));
      const removedValues = before.allowedValues.filter((v) => !afterValues.has(v.value));
      if (removedValues.length > 0) {
        // Create union of all values, preserving descriptions where available
        const valueMap = new Map<string, string>();
        for (const v of before.allowedValues) {
          valueMap.set(v.value, v.description ?? "");
        }
        for (const v of after.allowedValues) {
          if (!valueMap.has(v.value)) {
            valueMap.set(v.value, v.description ?? "");
          }
        }
        field.allowedValues = Array.from(valueMap.entries()).map(([value, description]) => ({
          value,
          description,
        }));
      }
    }
  }
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
  // Build breaking changes map for this single migration
  const breakingChanges = buildBreakingChangesMap([migration]);
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

        const typeChanges = typeName ? breakingChanges.get(typeName) : undefined;

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

        const typeChanges = typeName ? breakingChanges.get(typeName) : undefined;

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

        const typeChanges = typeName ? breakingChanges.get(typeName) : undefined;

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
  // Build breaking changes map for this single migration
  const breakingChanges = buildBreakingChangesMap([migration]);
  const affectedTypes = getAffectedTypeNames(migration);
  const deletedTypeNames = getDeletedTypeNames(migration);

  // Types - apply final schema values for types affected by this migration
  // Pre-migration used cloned requests, so the original changeSet still has correct values
  try {
    await Promise.all([
      // For newly created types that had breaking changes in this migration, send update with final values
      ...changeSet.type.creates
        .filter((create) => {
          const typeName = create.request.tailordbType?.name;
          return typeName && affectedTypes.has(typeName) && breakingChanges.has(typeName);
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
          return typeName && affectedTypes.has(typeName) && breakingChanges.has(typeName);
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
 * @param detailPlan - Whether to print detailed property-level changes
 * @returns Planned changes
 */
export async function planTailorDB(context: PlanContext, detailPlan = false) {
  const {
    client,
    workspaceId,
    application,
    forRemoval,
    config,
    noSchemaCheck,
    forceApplyAll = false,
  } = context;
  const tailordbs: TailorDBService[] = [];
  if (!forRemoval) {
    for (const tailordb of application.tailorDBServices) {
      await tailordb.loadTypes();
      tailordbs.push(tailordb);
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
  } = await planServices(client, workspaceId, application.name, tailordbs);
  const deletedServices = serviceChangeSet.deletes.map((del) => del.name);
  const [typeChangeSet, gqlPermissionChangeSet] = await Promise.all([
    planTypes(client, workspaceId, tailordbs, executors, deletedServices, undefined, forceApplyAll),
    planGqlPermissions(client, workspaceId, tailordbs, deletedServices, forceApplyAll),
  ]);

  serviceChangeSet.print(detailPlan);
  printTailorDBResourceChanges(typeChangeSet, gqlPermissionChangeSet, detailPlan);

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
      config,
      noSchemaCheck: noSchemaCheck ?? false,
    },
  };
}

type TailorDBDisplayEntry = GroupedDisplayEntry;

function collectTailorDBDisplayEntries(
  action: DisplayAction,
  typeItems: ReadonlyArray<HasName>,
  gqlPermissionItems: ReadonlyArray<HasName>,
): TailorDBDisplayEntry[] {
  const typeNames = new Set(typeItems.map((item) => item.name));
  const gqlPermissionNames = new Set(gqlPermissionItems.map((item) => item.name));
  const typeEntries = typeItems.map((item) => ({
    action,
    symbol: actionSymbol(action),
    name: item.name,
    labels: gqlPermissionNames.has(item.name) ? ["type", "gqlPermission"] : ["type"],
    detailLines: item.detailLines,
  }));
  const gqlPermissionOnlyEntries = gqlPermissionItems
    .filter((gqlPermission) => !typeNames.has(gqlPermission.name))
    .map((item) => ({
      action,
      symbol: actionSymbol(action),
      name: item.name,
      labels: ["gqlPermission"],
      detailLines: item.detailLines,
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

function printTailorDBResourceChanges(
  typeChangeSet: ChangeSet<HasName, HasName, HasName>,
  gqlPermissionChangeSet: ChangeSet<HasName, HasName, HasName>,
  detail = false,
) {
  const entries = formatTailorDBResourceChangeEntries(typeChangeSet, gqlPermissionChangeSet);
  if (entries.length === 0) {
    return;
  }

  logger.log(styles.bold("TailorDB resources:"));
  for (const entry of entries) {
    logger.log(`  ${entry.symbol} ${entry.name} (${entry.labels.join(", ")})`);
    if (detail) {
      entry.detailLines?.forEach((line) => logger.log(`    ${line}`));
    }
  }
}

type TailorDBDisplaySchema = {
  description?: string;
  fields?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  indexes?: Record<string, unknown>;
  files?: Record<string, unknown>;
  permission?: Record<string, unknown>;
};

type TailorDBDisplayType = {
  name?: string;
  schema?: TailorDBDisplaySchema;
};

function asTailorDBDisplayType(value: unknown): TailorDBDisplayType | undefined {
  return isPlainObject(value) ? (value as TailorDBDisplayType) : undefined;
}

function getTailorDBDisplaySchema(value: unknown): TailorDBDisplaySchema {
  return asTailorDBDisplayType(value)?.schema ?? {};
}

function getTailorDBDisplayFields(value: unknown): Record<string, unknown> {
  return getTailorDBDisplaySchema(value).fields ?? {};
}

function getTailorDBFieldHooks(field: unknown): Record<string, unknown> {
  return isPlainObject(field) && isPlainObject(field.hooks) ? field.hooks : {};
}

function formatTailorDBTypeCreateLines(typeConfig: unknown): string[] {
  const schema = getTailorDBDisplaySchema(typeConfig);
  const fields = Object.keys(getTailorDBDisplayFields(typeConfig)).sort();
  const hooks = Object.entries(getTailorDBDisplayFields(typeConfig))
    .flatMap(([fieldName, fieldConfig]) =>
      Object.keys(getTailorDBFieldHooks(fieldConfig)).map((hookName) => `${fieldName}.${hookName}`),
    )
    .sort();
  const relationships = Object.keys(schema.relationships ?? {}).sort();
  const indexes = Object.keys(schema.indexes ?? {}).sort();
  const files = Object.entries(schema.files ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, config]) =>
      isPlainObject(config) && typeof config.description === "string"
        ? `${name}(${config.description})`
        : name,
    );
  const permissions = Object.entries(schema.permission ?? {})
    .filter(([, rules]) => Array.isArray(rules) && rules.length > 0)
    .map(([action]) => action)
    .sort();

  const lines: string[] = [];
  if (schema.description) {
    lines.push(
      formatActionDetailLine("create", `description: ${JSON.stringify(schema.description)}`),
    );
  }
  if (fields.length > 0) {
    lines.push(formatActionDetailLine("create", `fields: ${fields.join(", ")}`));
  }
  if (hooks.length > 0) {
    lines.push(formatActionDetailLine("create", `hooks: ${hooks.join(", ")}`));
  }
  if (relationships.length > 0) {
    lines.push(formatActionDetailLine("create", `relationships: ${relationships.join(", ")}`));
  }
  if (indexes.length > 0) {
    lines.push(formatActionDetailLine("create", `indexes: ${indexes.join(", ")}`));
  }
  if (files.length > 0) {
    lines.push(formatActionDetailLine("create", `files: ${files.join(", ")}`));
  }
  if (permissions.length > 0) {
    lines.push(formatActionDetailLine("create", `permissions: ${permissions.join(", ")}`));
  }
  return lines;
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
  desired: Readonly<TailorDBService>,
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
  tailordbs: ReadonlyArray<TailorDBService>,
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
    const metaRequest = await buildMetaRequest(
      trn(workspaceId, tailordb.namespace),
      appName,
      existing?.allLabels,
    );
    if (existing) {
      if (!existing.label) {
        unmanaged.push({
          resourceType: "TailorDB service",
          resourceName: tailordb.namespace,
        });
      } else if (existing.label !== appName) {
        conflicts.push({
          resourceType: "TailorDB service",
          resourceName: tailordb.namespace,
          currentOwner: existing.label,
        });
      }

      if (
        existing.label === appName &&
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
    const label = existingServices[namespaceName]?.label;
    if (label && label !== appName) {
      resourceOwners.add(label);
    }
    // Only delete services managed by this application
    if (label === appName) {
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
  detailLines?: string[];
  request: MessageInitShape<typeof CreateTailorDBTypeRequestSchema>;
};

type UpdateType = {
  name: string;
  detailLines?: string[];
  request: MessageInitShape<typeof UpdateTailorDBTypeRequestSchema>;
};

type DeleteType = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBTypeRequestSchema>;
};

async function planTypes(
  client: OperatorClient,
  workspaceId: string,
  tailordbs: ReadonlyArray<TailorDBService>,
  executors: ReadonlyArray<Executor>,
  deletedServices: ReadonlyArray<string>,
  filteredTypesByNamespace?: Map<string, Record<string, TailorDBType>>,
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
        const existingComparable = normalizeComparableTailorDBType(existingType);
        const desiredComparable = normalizeComparableTailorDBType(tailordbType);
        if (!forceApplyAll && areNormalizedEqual(existingComparable, desiredComparable)) {
          changeSet.unchanged.push({ name: typeName });
        } else {
          changeSet.updates.push({
            name: typeName,
            detailLines: formatPropertyDiffLines(existingComparable, desiredComparable),
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
          detailLines: formatTailorDBTypeCreateLines(normalizeComparableTailorDBType(tailordbType)),
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
  const normalized = (normalizeProtoConfig(type) as TailorDBDisplayType | null) ?? undefined;
  const schema = normalized?.schema ?? {};
  return normalizeTailorDBCompareValue(
    {
      name: normalized?.name ?? "",
      schema: {
        description: schema.description ?? "",
        fields: schema.fields ?? {},
        relationships: schema.relationships ?? {},
        settings: schema.settings ?? {},
        indexes: schema.indexes ?? {},
        files: schema.files ?? {},
        permission: schema.permission ?? {},
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
 * Generate a TailorDB type manifest from parsed type
 * @param {TailorDBType} type - Parsed TailorDB type
 * @param {ReadonlySet<string>} executorUsedTypes - Set of types used by executors
 * @param {GqlOperations} [namespaceGqlOperations] - Default gqlOperations for the namespace (already normalized)
 * @returns {MessageInitShape<typeof TailorDBTypeSchema>} Type manifest
 */
function generateTailorDBTypeManifest(
  type: TailorDBType,
  executorUsedTypes: ReadonlySet<string>,
  namespaceGqlOperations?: GqlOperations,
): MessageInitShape<typeof TailorDBTypeSchema> {
  // This ensures that explicitly provided pluralForm like "PurchaseOrderList" becomes "purchaseOrderList"
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
      const fieldConfig = type.fields[fieldName].config;
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
        required: fieldConfig.required !== false,
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

  for (const [relationName, rel] of Object.entries(type.forwardRelationships)) {
    relationships[relationName] = {
      refType: rel.targetType,
      refField: rel.sourceField,
      srcField: rel.targetField,
      array: rel.isArray,
      description: rel.description,
    };
  }

  for (const [relationName, rel] of Object.entries(type.backwardRelationships)) {
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
  const permission = type.permissions.record
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
  fieldConfig: OperatorFieldConfig,
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
  fieldConfig: OperatorFieldConfig,
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
  fields: Record<string, OperatorFieldConfig>,
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
        required: nestedFieldConfig.required ?? true,
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
        required: nestedFieldConfig.required ?? true,
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
  permission: StandardTailorTypePermission,
): MessageInitShape<typeof TailorDBType_PermissionSchema> {
  const ret: MessageInitShape<typeof TailorDBType_PermissionSchema> = {};
  for (const [key, policies] of Object.entries(permission)) {
    ret[key as keyof StandardTailorTypePermission] = policies.map((policy) => protoPolicy(policy));
  }
  return ret;
}

function protoPolicy(
  policy: StandardActionPermission<"record">,
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
  condition: StandardPermissionCondition<"record">,
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
  operand: PermissionOperand,
): MessageInitShape<typeof TailorDBType_Permission_OperandSchema> {
  if (typeof operand === "object" && !Array.isArray(operand)) {
    if ("user" in operand) {
      return {
        kind: {
          case: "userField",
          value: operand.user,
        },
      };
    } else if ("record" in operand) {
      return {
        kind: {
          case: "recordField",
          value: operand.record,
        },
      };
    } else if ("newRecord" in operand) {
      return {
        kind: {
          case: "newRecordField",
          value: operand.newRecord,
        },
      };
    } else if ("oldRecord" in operand) {
      return {
        kind: {
          case: "oldRecordField",
          value: operand.oldRecord,
        },
      };
    } else {
      throw new Error(`Unknown operand: ${JSON.stringify(operand)}`);
    }
  }

  return {
    kind: {
      case: "value",
      value: fromJson(ValueSchema, operand),
    },
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
  tailordbs: ReadonlyArray<TailorDBService>,
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
      const gqlPermission = types[typeName].permissions.gql;
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
  permission: StandardTailorTypeGqlPermission,
): MessageInitShape<typeof TailorDBGQLPermissionSchema> {
  return {
    policies: permission.map((policy) => protoGqlPolicy(policy)),
  };
}

function protoGqlPolicy(
  policy: StandardGqlPermissionPolicy,
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
  condition: StandardPermissionCondition<"gql">,
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
  operand: PermissionOperand,
): MessageInitShape<typeof TailorDBGQLPermission_OperandSchema> {
  if (typeof operand === "object" && !Array.isArray(operand)) {
    if ("user" in operand) {
      return {
        kind: {
          case: "userField",
          value: operand.user,
        },
      };
    }
  }

  return {
    kind: {
      case: "value",
      value: fromJson(ValueSchema, operand),
    },
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
 * @param {ReadonlyMap<string, Record<string, TailorDBType>>} typesByNamespace - Types by namespace
 * @param {NamespaceWithMigrations[]} namespacesWithMigrations - Namespaces with migrations config
 * @returns {Promise<MigrationCheckResult[]>} Results for each namespace
 */
async function checkMigrationDiffs(
  typesByNamespace: ReadonlyMap<string, Record<string, TailorDBType>>,
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
