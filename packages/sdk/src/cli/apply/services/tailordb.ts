import * as path from "node:path";
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
import { fetchAll, type OperatorClient } from "../../client";
import { KyselyGeneratorID } from "../../generator/builtin/kysely-type";
import {
  hasChanges,
  formatMigrationDiff,
  formatDiffSummary,
} from "../../tailordb/migrate/diff-calculator";
import {
  reconstructSnapshotFromMigrations,
  compareLocalTypesWithSnapshot,
  assertValidMigrationFiles,
} from "../../tailordb/migrate/snapshot";
import { getNamespacesWithMigrations } from "../../tailordb/migrate/types";
import { logger } from "../../utils/logger";
import { buildMetaRequest, sdkNameLabelKey, trnPrefix, type WithLabel } from "./label";
import { getMigrationMachineUser, executeMigrations, detectPendingMigrations } from "./migration";
import { ChangeSet } from ".";
import type { ApplyPhase, PlanContext } from "..";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type {
  NamespaceWithMigrations,
  MigrationDiff,
  PendingMigration,
  DiffChange,
} from "../../tailordb/migrate/types";
import type { Application } from "@/cli/application";
import type { AppConfig } from "@/configure/config";
import type { TailorDBServiceConfig } from "@/configure/services/tailordb/types";
import type { Generator } from "@/parser/generator-config";
import type { Executor } from "@/parser/service/executor";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

/**
 * Validate migration files and detect pending migrations
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {Readonly<Application>} application - Application instance
 * @param {AppConfig} config - Application config
 * @param {string} configPath - Path to config file
 * @param {boolean} noSchemaCheck - Whether to skip schema diff check
 * @returns {Promise<PendingMigration[]>} List of pending migrations
 */
async function validateAndDetectMigrations(
  client: OperatorClient,
  workspaceId: string,
  application: Readonly<Application>,
  config: AppConfig,
  configPath: string,
  noSchemaCheck: boolean,
): Promise<PendingMigration[]> {
  const configDir = path.dirname(configPath);
  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);
  let pendingMigrations: PendingMigration[] = [];

  if (namespacesWithMigrations.length > 0) {
    // Validate migration file integrity (sequential numbers, no gaps, no duplicates)
    for (const { namespace, migrationsDir } of namespacesWithMigrations) {
      assertValidMigrationFiles(migrationsDir, namespace);
    }

    // Check for schema diffs if not skipped
    if (!noSchemaCheck) {
      const migrationResults = await checkMigrationDiffs(
        application.tailorDBServices,
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
    }

    // Detect pending migrations (migration scripts that haven't been executed yet)
    pendingMigrations = await detectPendingMigrations(
      client,
      workspaceId,
      namespacesWithMigrations,
    );

    if (pendingMigrations.length > 0) {
      logger.info(`Found ${pendingMigrations.length} pending migration(s) to execute.`);
    }
  }

  return pendingMigrations;
}

/**
 * Apply TailorDB-related changes for the given phase.
 * @param {OperatorClient} client - Operator client instance
 * @param {Awaited<ReturnType<typeof planTailorDB>>} result - Planned TailorDB changes
 * @param {Exclude<ApplyPhase, "delete">} [phase] - Apply phase
 * @param {object} [migrationContext] - Optional migration execution context
 * @param {string} migrationContext.workspaceId - Workspace ID
 * @param {Readonly<Application>} migrationContext.application - Application instance
 * @param {AppConfig} migrationContext.config - Application config
 * @param {Generator[]} migrationContext.generators - Generators configuration
 * @param {string} migrationContext.configPath - Config file path
 * @param {boolean} migrationContext.noSchemaCheck - Skip schema diff check
 * @returns {Promise<void>} Promise that resolves when TailorDB changes are applied
 */
export async function applyTailorDB(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planTailorDB>>,
  phase: Exclude<ApplyPhase, "delete"> = "create-update",
  migrationContext?: {
    workspaceId: string;
    application: Readonly<Application>;
    config: AppConfig;
    generators: Generator[];
    configPath: string;
    noSchemaCheck: boolean;
  },
) {
  const { changeSet } = result;

  if (phase === "create-update") {
    let pendingMigrations: PendingMigration[] = [];

    // Validate and detect migrations if context is provided
    if (migrationContext) {
      pendingMigrations = await validateAndDetectMigrations(
        client,
        migrationContext.workspaceId,
        migrationContext.application,
        migrationContext.config,
        migrationContext.configPath,
        migrationContext.noSchemaCheck,
      );
    }

    if (pendingMigrations.length > 0 && migrationContext) {
      // Migration flow: Automatically handle 3-phase migration internally
      // Phase 1: Pre-migration - create/update types with breaking fields as optional
      await executePreMigrationPhase(client, changeSet, pendingMigrations);

      // Phase 2: Execute migration scripts (only for migrations that require scripts)
      const migrationsRequiringScripts = pendingMigrations.filter(
        (m) => m.diff.requiresMigrationScript,
      );
      if (migrationsRequiringScripts.length > 0) {
        await executePendingMigrationsInternal(
          client,
          migrationContext,
          migrationsRequiringScripts,
        );
      }

      // Phase 3: Post-migration - apply final types (required: true) and deletions
      await executePostMigrationPhase(client, changeSet, pendingMigrations);
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
      await Promise.all([
        ...changeSet.type.creates.map((create) => client.createTailorDBType(create.request)),
        ...changeSet.type.updates.map((update) => client.updateTailorDBType(update.request)),
      ]);

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
    // Delete in reverse order of dependencies
    // GQLPermissions
    await Promise.all(
      changeSet.gqlPermission.deletes.map((del) => client.deleteTailorDBGQLPermission(del.request)),
    );

    // Types
    await Promise.all(changeSet.type.deletes.map((del) => client.deleteTailorDBType(del.request)));
  } else if (phase === "delete-services") {
    // Services only
    await Promise.all(
      changeSet.service.deletes.map((del) => client.deleteTailorDBService(del.request)),
    );
  }
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

/**
 * Type request with TailorDB type manifest
 */
type TypeRequestWithManifest = {
  tailordbType?: MessageInitShape<typeof TailorDBTypeSchema>;
  [key: string]: unknown;
};

/**
 * Modify a type manifest for pre-migration phase
 * - Makes breaking required fields optional
 * - Keeps unique=false for fields with new unique constraint
 * - Keeps old allowedValues + adds new ones (no deletion)
 * @param {T} request - Type request with manifest
 * @param {BreakingChangesMap} breakingChanges - Map of breaking changes
 * @returns {T} Modified request with pre-migration safe values
 */
function modifyManifestForPreMigration<T extends TypeRequestWithManifest>(
  request: T,
  breakingChanges: BreakingChangesMap,
): T {
  const typeName = request.tailordbType?.name;
  if (!typeName) return request;

  const typeChanges = breakingChanges.get(typeName);
  if (!typeChanges || typeChanges.size === 0) return request;

  // Deep clone the request to avoid modifying the original
  const modifiedRequest = structuredClone(request);

  if (!modifiedRequest.tailordbType?.schema?.fields) return modifiedRequest;

  const fields = modifiedRequest.tailordbType.schema.fields;
  for (const [fieldName, change] of typeChanges) {
    if (!isBreakingChange(change) || !fields[fieldName]) continue;

    const before = change.before as FieldConfig | undefined;
    const after = change.after as FieldConfig | undefined;

    // Required field added: make optional for pre-migration
    if (change.kind === "field_added" && after?.required) {
      fields[fieldName].required = false;
    }

    // Optional to required: keep optional for pre-migration (no action needed, field already exists)
    // The required=true will be applied in post-migration

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
      const removedValues = before.allowedValues.filter((v) => !after.allowedValues!.includes(v));
      if (removedValues.length > 0) {
        // Union of old and new allowedValues
        const unionValues = [...new Set([...before.allowedValues, ...after.allowedValues])];
        // Convert string[] to TailorDBType_Value[] format
        fields[fieldName].allowedValues = unionValues.map((v) => ({
          value: v,
          description: "",
        }));
      }
    }
  }

  return modifiedRequest;
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

  // Types - modify manifests to make breaking fields optional
  await Promise.all([
    ...changeSet.type.creates.map((create) => {
      const modified = modifyManifestForPreMigration(create.request, breakingChanges);
      return client.createTailorDBType(modified);
    }),
    ...changeSet.type.updates.map((update) => {
      const modified = modifyManifestForPreMigration(update.request, breakingChanges);
      return client.updateTailorDBType(modified);
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
 * @param {PendingMigration[]} _pendingMigrations - Pending migrations (unused, for consistency)
 * @returns {Promise<void>} Promise that resolves when post-migration phase completes
 */
async function executePostMigrationPhase(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  _pendingMigrations: PendingMigration[],
): Promise<void> {
  // Types - apply final manifest (with required: true)
  await Promise.all([
    ...changeSet.type.updates.map((update) => client.updateTailorDBType(update.request)),
  ]);

  // GQLPermissions deletions
  await Promise.all(
    changeSet.gqlPermission.deletes.map((del) => client.deleteTailorDBGQLPermission(del.request)),
  );

  // Type deletions
  await Promise.all(changeSet.type.deletes.map((del) => client.deleteTailorDBType(del.request)));
}

/**
 * Execute pending migration scripts
 * @param {OperatorClient} client - Operator client
 * @param {object} context - Migration context
 * @param {string} context.workspaceId - Workspace ID
 * @param {Readonly<Application>} context.application - Application instance
 * @param {AppConfig} context.config - Application config
 * @param {Generator[]} context.generators - Generators configuration
 * @param {PendingMigration[]} pendingMigrations - Pending migrations to execute
 * @returns {Promise<void>} Promise that resolves when migrations complete
 */
async function executePendingMigrationsInternal(
  client: OperatorClient,
  context: {
    workspaceId: string;
    application: Readonly<Application>;
    config: AppConfig;
    generators: Generator[];
  },
  pendingMigrations: PendingMigration[],
): Promise<void> {
  // Get auth namespace
  const authService = context.application.authService;
  if (!authService) {
    throw new Error("Auth configuration is required to execute migration scripts.");
  }
  const authNamespace = authService.config.name;

  // Get machine users
  const machineUsers = authService.config.machineUsers
    ? Object.keys(authService.config.machineUsers)
    : undefined;

  // Get migration config
  const firstMigration = pendingMigrations[0];
  const dbConfig = context.config.db?.[firstMigration.namespace] as
    | TailorDBServiceConfig
    | undefined;
  const migrationConfig = dbConfig?.migration;

  // Get machine user
  const machineUserName = getMigrationMachineUser(migrationConfig, machineUsers);
  if (!machineUserName) {
    throw new Error(
      "No machine user available for migration execution. " +
        "Either configure 'migration.machineUser' in db config or define machine users in auth config.",
    );
  }

  // Get generated TailorDB path
  const kyselyGenerator = context.generators.find(
    (g) => g.id === KyselyGeneratorID || (g as { id?: string }).id === KyselyGeneratorID,
  );
  if (!kyselyGenerator) {
    throw new Error(
      "Kysely generator (@tailor-platform/kysely-type) is required for migration execution. " +
        "Add it to your generators configuration.",
    );
  }
  const generatedTailorDBPath = (kyselyGenerator as { options?: { distPath?: string } }).options
    ?.distPath;
  if (!generatedTailorDBPath) {
    throw new Error("Kysely generator distPath is not configured.");
  }

  // Execute migrations
  await executeMigrations(
    {
      client,
      workspaceId: context.workspaceId,
      authNamespace,
      machineUserName,
      generatedTailorDBPath,
    },
    pendingMigrations,
  );
}

/**
 * Plan TailorDB-related changes based on current and desired state.
 * @param {PlanContext} context - Planning context
 * @returns {Promise<unknown>} Planned changes
 */
export async function planTailorDB({ client, workspaceId, application, forRemoval }: PlanContext) {
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
  const typeChangeSet = await planTypes(client, workspaceId, tailordbs, executors, deletedServices);
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
  const changeSet: ChangeSet<CreateService, UpdateService, DeleteService> = new ChangeSet(
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
      };
    }),
  );

  for (const tailordb of tailordbs) {
    const existing = existingServices[tailordb.namespace];
    const metaRequest = await buildMetaRequest(trn(workspaceId, tailordb.namespace), appName);
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
) {
  const changeSet: ChangeSet<CreateType, UpdateType, DeleteType> = new ChangeSet("TailorDB types");

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

    const types = tailordb.getTypes();
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
  const changeSet: ChangeSet<CreateGqlPermission, UpdateGqlPermission, DeleteGqlPermission> =
    new ChangeSet("TailorDB gqlPermissions");

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
 * @param {TailorDBService[]} tailordbServices - TailorDB services to check
 * @param {NamespaceWithMigrations[]} namespacesWithMigrations - Namespaces with migrations config
 * @returns {Promise<MigrationCheckResult[]>} Results for each namespace
 */
async function checkMigrationDiffs(
  tailordbServices: readonly TailorDBService[],
  namespacesWithMigrations: NamespaceWithMigrations[],
): Promise<MigrationCheckResult[]> {
  const results: MigrationCheckResult[] = [];

  for (const { namespace, migrationsDir } of namespacesWithMigrations) {
    const tailordbService = tailordbServices.find((s) => s.namespace === namespace);
    if (!tailordbService) {
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
    const localTypes = tailordbService.getTypes();
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
