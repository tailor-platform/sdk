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
  type TailorDBType,
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
import { type TailorDBService } from "@/cli/application/tailordb/service";
import {
  type PermissionOperand,
  type StandardActionPermission,
  type StandardGqlPermissionPolicy,
  type StandardPermissionCondition,
  type StandardTailorTypeGqlPermission,
  type StandardTailorTypePermission,
  type OperatorFieldConfig,
  type ParsedTailorDBType,
} from "@/parser/service/tailordb/types";
import { createChangeSet } from "..";
import { fetchAll, type OperatorClient } from "../../../client";
import {
  getNamespacesWithMigrations,
  type NamespaceWithMigrations,
} from "../../../tailordb/migrate/config";
import {
  hasChanges,
  formatMigrationDiff,
  formatDiffSummary,
  type MigrationDiff,
  type DiffChange,
} from "../../../tailordb/migrate/diff-calculator";
import {
  reconstructSnapshotFromMigrations,
  compareLocalTypesWithSnapshot,
  assertValidMigrationFiles,
  formatMigrationNumber,
  compareRemoteWithSnapshot,
  formatSchemaDrifts,
} from "../../../tailordb/migrate/snapshot";
import { logger, styles } from "../../../utils/logger";
import { buildMetaRequest, sdkNameLabelKey, trnPrefix, type WithLabel } from "../label";
import {
  executeMigrations,
  detectPendingMigrations,
  updateMigrationLabel,
  buildFilteredTypesForVersion,
  type MigrationContext,
} from "./migration";
import type { ApplyPhase, PlanContext } from "../..";
import type {
  PendingMigration,
  RemoteSchemaVerificationResult,
} from "../../../tailordb/migrate/types";
import type { OwnerConflict, UnmanagedResource } from "../confirm";
import type { LoadedConfig } from "@/cli/config-loader";
import type { TailorDBServiceConfig } from "@/configure/services/tailordb/types";
import type { Executor } from "@/parser/service/executor";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

// ============================================================================
// Remote Schema Verification
// ============================================================================

/**
 * Fetch all TailorDB types from remote for a namespace
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {string} namespace - TailorDB namespace
 * @returns {Promise<TailorDBType[]>} Remote TailorDB types
 */
async function fetchRemoteTypes(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
): Promise<TailorDBType[]> {
  return fetchAll(async (pageToken) => {
    try {
      const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes({
        workspaceId,
        namespaceName: namespace,
        pageToken,
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
 * @param {ReadonlyMap<string, Record<string, ParsedTailorDBType>>} typesByNamespace - Types by namespace
 * @param {LoadedConfig} config - Loaded application config (includes path)
 * @param {boolean} noSchemaCheck - Whether to skip schema diff check
 * @returns {Promise<PendingMigration[]>} List of pending migrations
 */
async function validateAndDetectMigrations(
  client: OperatorClient,
  workspaceId: string,
  typesByNamespace: ReadonlyMap<string, Record<string, ParsedTailorDBType>>,
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
 * Apply TailorDB-related changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned TailorDB changes
 * @param phase - Apply phase (defaults to "create-update")
 * @returns Promise that resolves when TailorDB changes are applied
 */
export async function applyTailorDB(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planTailorDB>>,
  phase: Exclude<ApplyPhase, "delete"> = "create-update",
) {
  const { changeSet, context: migrationContext } = result;

  if (phase === "create-update") {
    let pendingMigrations: PendingMigration[] = [];

    // Validate and detect migrations
    // Build types by namespace map
    const typesByNamespace = new Map<string, Record<string, ParsedTailorDBType>>();
    for (const tailordb of migrationContext.application.tailorDBServices) {
      const types = tailordb.getTypes();
      if (types) {
        typesByNamespace.set(tailordb.namespace, types);
      }
    }

    pendingMigrations = await validateAndDetectMigrations(
      client,
      migrationContext.workspaceId,
      typesByNamespace,
      migrationContext.config,
      migrationContext.noSchemaCheck,
    );

    if (pendingMigrations.length > 0) {
      // Migration flow: Automatically handle 3-phase migration internally
      // Phase 1: Pre-migration - create/update types with breaking fields as optional
      await executePreMigrationPhase(client, changeSet, pendingMigrations);

      // Phase 2: Execute migration scripts (only for migrations that require scripts)
      const migrationsRequiringScripts = pendingMigrations.filter(
        (m) => m.diff.requiresMigrationScript,
      );
      if (migrationsRequiringScripts.length > 0) {
        // Extract auth information
        const authService = migrationContext.application.authService;
        if (!authService) {
          throw new Error("Auth configuration is required to execute migration scripts.");
        }

        // Build dbConfig map for all namespaces
        const dbConfigMap: Record<string, TailorDBServiceConfig | undefined> = {};
        for (const migration of migrationsRequiringScripts) {
          if (!(migration.namespace in dbConfigMap)) {
            dbConfigMap[migration.namespace] = migrationContext.config.db?.[migration.namespace] as
              | TailorDBServiceConfig
              | undefined;
          }
        }

        const migrationCtx: MigrationContext = {
          client,
          workspaceId: migrationContext.workspaceId,
          authNamespace: authService.config.name,
          machineUsers: authService.config.machineUsers
            ? Object.keys(authService.config.machineUsers)
            : undefined,
          dbConfig: dbConfigMap,
        };

        await executeMigrations(migrationCtx, migrationsRequiringScripts);
      }

      // Phase 3: Post-migration - apply final types (required: true) and deletions
      await executePostMigrationPhase(client, changeSet, pendingMigrations);

      // Update migration labels for non-breaking migrations (those that didn't require scripts)
      const nonBreakingMigrations = pendingMigrations.filter(
        (m) => !m.diff.requiresMigrationScript,
      );
      for (const migration of nonBreakingMigrations) {
        await updateMigrationLabel(
          client,
          migrationContext.workspaceId,
          migration.namespace,
          migration.number,
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

  // Update migration labels if TAILOR_INTERNAL_APPLY_MIGRATION_VERSION is set
  // This ensures the migration label matches the applied schema version
  if (phase === "create-update") {
    const maxVersionEnv = process.env.TAILOR_INTERNAL_APPLY_MIGRATION_VERSION;
    if (maxVersionEnv) {
      const maxVersion = parseInt(maxVersionEnv, 10);
      if (Number.isInteger(maxVersion)) {
        const configDir = path.dirname(migrationContext.config.path);
        const namespacesWithMigrations = getNamespacesWithMigrations(
          migrationContext.config,
          configDir,
        );
        for (const { namespace } of namespacesWithMigrations) {
          await updateMigrationLabel(client, migrationContext.workspaceId, namespace, maxVersion);
        }
      }
    }
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
  allowedValues?: string[];
}

/**
 * Check if a field change requires pre/post-migration handling
 * - Adding a required field (pre: add as optional, post: make required)
 * - Changing optional to required (post: make required)
 * - Adding unique constraint (post: add unique)
 * - Removing enum values (pre: add new values only, post: remove old values)
 * @param {DiffChange} change - Diff change to check
 * @returns {boolean} True if the change requires pre/post-migration handling
 */
function isBreakingChange(change: DiffChange): boolean {
  const before = change.before as FieldConfig | undefined;
  const after = change.after as FieldConfig | undefined;

  if (change.kind === "field_added") {
    return after?.required === true;
  }

  if (change.kind !== "field_modified") {
    return false;
  }

  // Optional to required
  if (!before?.required && after?.required) {
    return true;
  }

  // Unique constraint added
  if (!(before?.unique ?? false) && (after?.unique ?? false)) {
    return true;
  }

  // Enum values removed
  if (before?.allowedValues && after?.allowedValues) {
    return before.allowedValues.some((v) => !after.allowedValues!.includes(v));
  }

  return false;
}

// ============================================================================
// Migration Execution Helpers
// ============================================================================

type TailorDBChangeSet = Awaited<ReturnType<typeof planTailorDB>>["changeSet"];

/**
 * Execute pre-migration phase: Create/update types with breaking fields as optional
 * @param {OperatorClient} client - Operator client instance
 * @param {TailorDBChangeSet} changeSet - TailorDB change set
 * @param {PendingMigration[]} pendingMigrations - Pending migrations
 * @returns {Promise<void>} Promise that resolves when pre-migration phase completes
 */
async function executePreMigrationPhase(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  pendingMigrations: PendingMigration[],
): Promise<void> {
  // Services - same as create-update
  await Promise.all([
    ...changeSet.service.creates.map(async (create) => {
      await client.createTailorDBService(create.request);
      await client.setMetadata(create.metaRequest);
    }),
    ...changeSet.service.updates.map((update) => client.setMetadata(update.metaRequest)),
  ]);

  // Build breaking changes map from pending migrations
  const breakingChanges = buildBreakingChangesMap(pendingMigrations);

  // Types - modify protobuf messages directly (they are mutable)
  await Promise.all([
    ...changeSet.type.creates.map((create) => {
      const typeName = create.request.tailordbType?.name;
      const typeChanges = typeName ? breakingChanges.get(typeName) : undefined;

      if (!typeChanges || typeChanges.size === 0) {
        return client.createTailorDBType(create.request);
      }

      // Protobuf messages are mutable - modify directly
      if (create.request.tailordbType?.schema?.fields) {
        const fields = create.request.tailordbType.schema.fields;
        for (const [fieldName, change] of typeChanges) {
          if (!isBreakingChange(change) || !fields[fieldName]) continue;

          const after = change.after as FieldConfig | undefined;
          if (change.kind === "field_added" && after?.required) {
            fields[fieldName].required = false;
          }
        }
      }

      return client.createTailorDBType(create.request);
    }),
    ...changeSet.type.updates.map((update) => {
      const typeName = update.request.tailordbType?.name;
      const typeChanges = typeName ? breakingChanges.get(typeName) : undefined;

      if (!typeChanges || typeChanges.size === 0) {
        return client.updateTailorDBType(update.request);
      }

      // Protobuf messages are mutable - modify directly
      if (update.request.tailordbType?.schema?.fields) {
        const fields = update.request.tailordbType.schema.fields;

        for (const [fieldName, change] of typeChanges) {
          if (!isBreakingChange(change) || !fields[fieldName]) continue;

          const before = change.before as FieldConfig | undefined;
          const after = change.after as FieldConfig | undefined;

          // Required field added: make optional for pre-migration
          if (change.kind === "field_added" && after?.required) {
            fields[fieldName].required = false;
          }

          // Unique constraint added: keep unique=false for pre-migration
          if (
            change.kind === "field_modified" &&
            !(before?.unique ?? false) &&
            (after?.unique ?? false)
          ) {
            fields[fieldName].unique = false;
          }

          // Enum values removed: keep old values + add new values (union)
          if (change.kind === "field_modified" && before?.allowedValues && after?.allowedValues) {
            const removedValues = before.allowedValues.filter(
              (v) => !after.allowedValues!.includes(v),
            );
            if (removedValues.length > 0) {
              const unionValues = [...new Set([...before.allowedValues, ...after.allowedValues])];
              fields[fieldName].allowedValues = unionValues.map((v) => ({
                value: v,
                description: "",
              }));
            }
          }
        }
      }

      return client.updateTailorDBType(update.request);
    }),
  ]);

  // GQLPermissions - same as create-update
  await Promise.all([
    ...changeSet.gqlPermission.creates.map((create) =>
      client.createTailorDBGQLPermission(create.request),
    ),
    ...changeSet.gqlPermission.updates.map((update) =>
      client.updateTailorDBGQLPermission(update.request),
    ),
  ]);
}

/**
 * Execute post-migration phase: Apply final types (with required: true) and deletions
 * @param {OperatorClient} client - Operator client instance
 * @param {TailorDBChangeSet} changeSet - TailorDB change set
 * @param {PendingMigration[]} pendingMigrations - Pending migrations
 * @returns {Promise<void>} Promise that resolves when post-migration phase completes
 */
async function executePostMigrationPhase(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  pendingMigrations: PendingMigration[],
): Promise<void> {
  // Rebuild breaking changes map to restore values modified in pre-migration phase
  const breakingChanges = buildBreakingChangesMap(pendingMigrations);

  // Types - restore final manifest values (undo pre-migration modifications)
  // Since pre-migration modified the protobuf messages directly, we need to restore
  // the original values from change.after before sending updates
  try {
    await Promise.all([
      ...changeSet.type.updates.map((update) => {
        const typeName = update.request.tailordbType?.name;
        const typeChanges = typeName ? breakingChanges.get(typeName) : undefined;

        // Restore values modified in pre-migration phase
        if (typeChanges && typeChanges.size > 0 && update.request.tailordbType?.schema?.fields) {
          const fields = update.request.tailordbType.schema.fields;

          for (const [fieldName, change] of typeChanges) {
            if (!isBreakingChange(change) || !fields[fieldName]) continue;

            const before = change.before as FieldConfig | undefined;
            const after = change.after as FieldConfig | undefined;

            // Restore required field added: set to the intended required value
            if (change.kind === "field_added" && after?.required) {
              fields[fieldName].required = true;
            }

            // Restore optional to required change
            if (change.kind === "field_modified" && !before?.required && after?.required) {
              fields[fieldName].required = true;
            }

            // Restore unique constraint added
            if (
              change.kind === "field_modified" &&
              !(before?.unique ?? false) &&
              (after?.unique ?? false)
            ) {
              fields[fieldName].unique = true;
            }

            // Restore enum values (apply final allowedValues from after)
            if (change.kind === "field_modified" && before?.allowedValues && after?.allowedValues) {
              const removedValues = before.allowedValues.filter(
                (v) => !after.allowedValues!.includes(v),
              );
              if (removedValues.length > 0) {
                fields[fieldName].allowedValues = after.allowedValues.map((v) => ({
                  value: v,
                  description: "",
                }));
              }
            }
          }
        }

        return client.updateTailorDBType(update.request);
      }),
    ]);
  } catch (error) {
    handleOptionalToRequiredError(error, [
      "This error occurred during post-migration phase. Please check your migration script.",
      "Ensure all existing records have values for fields being changed to required.",
    ]);
  }

  // GQLPermissions deletions
  await Promise.all(
    changeSet.gqlPermission.deletes.map((del) => client.deleteTailorDBGQLPermission(del.request)),
  );

  // Type deletions
  await Promise.all(changeSet.type.deletes.map((del) => client.deleteTailorDBType(del.request)));
}

/**
 * Plan TailorDB-related changes based on current and desired state.
 * @param context - Planning context
 * @returns Planned changes
 */
export async function planTailorDB(context: PlanContext) {
  const { client, workspaceId, application, forRemoval, config, noSchemaCheck } = context;
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

  // Check for TAILOR_INTERNAL_APPLY_MIGRATION_VERSION and build filtered types if set (only for non-removal)
  let filteredTypesByNamespace: Map<string, Record<string, ParsedTailorDBType>> | undefined;
  let skipSchemaCheck = false;
  if (!forRemoval) {
    const maxVersionEnv = process.env.TAILOR_INTERNAL_APPLY_MIGRATION_VERSION;
    if (maxVersionEnv) {
      const maxVersion = parseInt(maxVersionEnv, 10);
      if (!Number.isInteger(maxVersion)) {
        throw new Error(
          `Invalid TAILOR_INTERNAL_APPLY_MIGRATION_VERSION: "${maxVersionEnv}". Must be a valid integer.`,
        );
      }

      logger.info(
        `Using schema reconstructed up to migration version ${styles.bold(formatMigrationNumber(maxVersion))}`,
      );
      logger.info("Schema check will be skipped (local types are ahead of target version)", {
        mode: "plain",
      });
      logger.newline();

      skipSchemaCheck = true;
      filteredTypesByNamespace = await buildFilteredTypesForVersion(
        maxVersion,
        application,
        config,
      );
    }
  }

  const {
    changeSet: serviceChangeSet,
    conflicts,
    unmanaged,
    resourceOwners,
  } = await planServices(client, workspaceId, application.name, tailordbs);
  const deletedServices = serviceChangeSet.deletes.map((del) => del.name);
  const typeChangeSet = await planTypes(
    client,
    workspaceId,
    tailordbs,
    executors,
    deletedServices,
    filteredTypesByNamespace,
  );
  const gqlPermissionChangeSet = await planGqlPermissions(
    client,
    workspaceId,
    tailordbs,
    deletedServices,
  );

  serviceChangeSet.print();
  typeChangeSet.print();
  gqlPermissionChangeSet.print();

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
      noSchemaCheck: skipSchemaCheck || (noSchemaCheck ?? false),
    },
  };
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

  const withoutLabel = await fetchAll(async (pageToken) => {
    try {
      const { tailordbServices, nextPageToken } = await client.listTailorDBServices({
        workspaceId,
        pageToken,
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

      changeSet.updates.push({
        name: tailordb.namespace,
        metaRequest,
      });
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
  tailordbs: ReadonlyArray<TailorDBService>,
  executors: ReadonlyArray<Executor>,
  deletedServices: ReadonlyArray<string>,
  filteredTypesByNamespace?: Map<string, Record<string, ParsedTailorDBType>>,
) {
  const changeSet = createChangeSet<CreateType, UpdateType, DeleteType>("TailorDB types");

  const fetchTypes = (namespaceName: string) => {
    return fetchAll(async (pageToken) => {
      try {
        const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes({
          workspaceId,
          namespaceName,
          pageToken,
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
    if (
      executor.trigger.kind === "recordCreated" ||
      executor.trigger.kind === "recordUpdated" ||
      executor.trigger.kind === "recordDeleted"
    ) {
      executorUsedTypes.add(executor.trigger.typeName);
    }
  }

  for (const tailordb of tailordbs) {
    const existingTypes = await fetchTypes(tailordb.namespace);
    const existingNameSet = new Set<string>();
    existingTypes.forEach((type) => existingNameSet.add(type.name));

    // Use filtered types if provided, otherwise use local types
    const types = filteredTypesByNamespace?.get(tailordb.namespace) ?? tailordb.getTypes();

    for (const typeName of Object.keys(types)) {
      const tailordbType = generateTailorDBTypeManifest(types[typeName], executorUsedTypes);
      if (existingNameSet.has(typeName)) {
        changeSet.updates.push({
          name: typeName,
          request: {
            workspaceId,
            namespaceName: tailordb.namespace,
            tailordbType,
          },
        });
        existingNameSet.delete(typeName);
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
    existingNameSet.forEach((name) => {
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

// TODO(remiposo): Copied the type-processor / aggregator processing almost as-is.
// This will need refactoring later.
/**
 * Generate a TailorDB type manifest from parsed type
 * @param {ParsedTailorDBType} type - Parsed TailorDB type
 * @param {ReadonlySet<string>} executorUsedTypes - Set of types used by executors
 * @returns {MessageInitShape<typeof TailorDBTypeSchema>} Type manifest
 */
function generateTailorDBTypeManifest(
  type: ParsedTailorDBType,
  executorUsedTypes: ReadonlySet<string>,
): MessageInitShape<typeof TailorDBTypeSchema> {
  // This ensures that explicitly provided pluralForm like "PurchaseOrderList" becomes "purchaseOrderList"
  const pluralForm = inflection.camelize(type.pluralForm, true);

  const defaultSettings = {
    aggregation: type.settings?.aggregation || false,
    bulkUpsert: type.settings?.bulkUpsert || false,
    draft: false,
    defaultQueryLimitSize: 100n,
    maxBulkUpsertSize: 1000n,
    pluralForm,
    publishRecordEvents: false,
  };
  if (executorUsedTypes.has(type.name)) {
    defaultSettings.publishRecordEvents = true;
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
        validate: (fieldConfig.validate || []).map((val) => ({
          action: TailorDBType_PermitAction.DENY,
          errorMessage: val.errorMessage || "",
          ...(val.script && {
            script: {
              expr: val.script.expr ? `!${val.script.expr}` : "",
            },
          }),
        })),
        array: fieldConfig.array || false,
        index: fieldConfig.index || false,
        unique: fieldConfig.unique || false,
        foreignKey: fieldConfig.foreignKey || false,
        foreignKeyType: fieldConfig.foreignKeyType,
        foreignKeyField: fieldConfig.foreignKeyField,
        required: fieldConfig.required !== false,
        vector: fieldConfig.vector || false,
        ...(fieldConfig.hooks && {
          hooks: {
            create: fieldConfig.hooks?.create
              ? {
                  expr: fieldConfig.hooks.create.expr || "",
                }
              : undefined,
            update: fieldConfig.hooks?.update
              ? {
                  expr: fieldConfig.hooks.update.expr || "",
                }
              : undefined,
          },
        }),
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
        validate: [],
        required: nestedFieldConfig.required ?? true,
        array: nestedFieldConfig.array ?? false,
        index: false,
        unique: false,
        foreignKey: false,
        vector: false,
        fields: deepNestedFields,
      };
    } else {
      nestedFields[nestedFieldName] = {
        type: nestedType,
        allowedValues: nestedType === "enum" ? nestedFieldConfig.allowedValues || [] : [],
        description: nestedFieldConfig.description || "",
        validate: [],
        required: nestedFieldConfig.required ?? true,
        array: nestedFieldConfig.array ?? false,
        index: false,
        unique: false,
        foreignKey: false,
        vector: false,
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
) {
  const changeSet = createChangeSet<CreateGqlPermission, UpdateGqlPermission, DeleteGqlPermission>(
    "TailorDB gqlPermissions",
  );

  const fetchGqlPermissions = (namespaceName: string) => {
    return fetchAll(async (pageToken) => {
      try {
        const { permissions, nextPageToken } = await client.listTailorDBGQLPermissions({
          workspaceId,
          namespaceName,
          pageToken,
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

    const types = tailordb.getTypes();
    for (const typeName of Object.keys(types)) {
      const gqlPermission = types[typeName].permissions.gql;
      if (!gqlPermission) {
        continue;
      }
      if (existingNameSet.has(typeName)) {
        changeSet.updates.push({
          name: typeName,
          request: {
            workspaceId,
            namespaceName: tailordb.namespace,
            typeName: typeName,
            permission: protoGqlPermission(gqlPermission),
          },
        });
        existingNameSet.delete(typeName);
      } else {
        changeSet.creates.push({
          name: typeName,
          request: {
            workspaceId,
            namespaceName: tailordb.namespace,
            typeName: typeName,
            permission: protoGqlPermission(gqlPermission),
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
    } else {
      // RecordOperand is not valid for GQL permissions
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
 * @param {ReadonlyMap<string, Record<string, ParsedTailorDBType>>} typesByNamespace - Types by namespace
 * @param {NamespaceWithMigrations[]} namespacesWithMigrations - Namespaces with migrations config
 * @returns {Promise<MigrationCheckResult[]>} Results for each namespace
 */
async function checkMigrationDiffs(
  typesByNamespace: ReadonlyMap<string, Record<string, ParsedTailorDBType>>,
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
