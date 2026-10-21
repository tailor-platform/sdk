import { isDeepStrictEqual } from "node:util";
import { type MessageInitShape } from "@bufbuild/protobuf";
import {
  applyPreMigrationFieldAdjustments,
  applyPreMigrationIndexAdjustments,
  buildPreMigrationChangesMap,
  buildPreMigrationIndexChangesMap,
  createPreMigrationSnapshotType,
} from "#/cli/commands/tailordb/migrate/pre-migration-schema";
import {
  reconstructSnapshotFromMigrations,
  formatMigrationNumber,
  INITIAL_SCHEMA_NUMBER,
  isMigrationRestricted,
  type SchemaSnapshot,
  type TailorDBSnapshotType,
} from "#/cli/commands/tailordb/migrate/snapshot";
import {
  generateTailorDBTypeManifestFromSnapshot,
  protoGqlPermission,
} from "#/cli/commands/tailordb/migrate/snapshot-manifest";
import { handleOptionalToRequiredError } from "#/cli/commands/tailordb/migrate/types";
import { fetchAllTolerant, isNotFoundError, type OperatorClient } from "#/cli/shared/client";
import { getErrorDiagnostics, withErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { CLIError, toError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import type {
  FieldDiffChange,
  TableScriptsModifiedChange,
} from "#/cli/commands/tailordb/migrate/diff-calculator";
import type { TailorDBDeployInput } from "#/cli/commands/tailordb/migrate/schema-checks";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { TailorDBChangeSet } from "./plan";
import type { TailorDBTypeSchema } from "@tailor-platform/tailor-proto/tailordb_resource_pb";

type MigrationTableSettings = {
  bulkUpsert: boolean;
  publishRecordEvents: boolean;
  disableGqlOperations?: {
    create: boolean;
    update: boolean;
    delete: boolean;
    read: boolean;
  };
  tailordbType?: MessageInitShape<typeof TailorDBTypeSchema>;
};

export type MigrationRestrictionState = Map<string, Map<string, MigrationTableSettings>>;

/**
 * Capture the settings and table names active immediately before migration writes.
 * @param client - Operator client instance
 * @param workspaceId - Target workspace ID
 * @param namespaceNames - Migrating namespaces to inspect
 * @returns Settings keyed by namespace and table name
 */
export async function captureMigrationRestrictionState(
  client: OperatorClient,
  workspaceId: string,
  namespaceNames: ReadonlySet<string>,
): Promise<MigrationRestrictionState> {
  const state: MigrationRestrictionState = new Map();
  for (const namespaceName of namespaceNames) {
    const types = await fetchAllTolerant(async (pageToken, maxPageSize) => {
      const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes({
        workspaceId,
        namespaceName,
        pageToken,
        pageSize: maxPageSize,
      });
      return [tailordbTypes, nextPageToken];
    });
    const settingsByTable = new Map<string, MigrationTableSettings>();
    for (const type of types) {
      const settings = type.schema?.settings;
      if (!type.name) continue;
      settingsByTable.set(type.name, {
        bulkUpsert: settings?.bulkUpsert ?? false,
        publishRecordEvents: settings?.publishRecordEvents ?? false,
        // Defensive: the generated client always populates these bools, so the
        // fallbacks only guard a hand-built client and keep the shape identical
        // to resolveMigrationSnapshotSettings, whose settings come from a
        // MessageInitShape that declares the fields optional.
        // oxlint-disable typescript/no-unnecessary-condition
        ...(settings?.disableGqlOperations && {
          disableGqlOperations: {
            create: settings.disableGqlOperations.create ?? false,
            update: settings.disableGqlOperations.update ?? false,
            delete: settings.disableGqlOperations.delete ?? false,
            read: settings.disableGqlOperations.read ?? false,
          },
        }),
        // oxlint-enable typescript/no-unnecessary-condition
        tailordbType: structuredClone(type),
      });
    }
    state.set(namespaceName, settingsByTable);
  }
  return state;
}

/**
 * Get the set of table names affected by a migration
 * @param {PendingMigration} migration - Pending migration
 * @returns {Set<string>} Set of affected table names
 */
function getAffectedTableNames(migration: PendingMigration): Set<string> {
  const tableNames = new Set<string>();
  for (const change of migration.diff.changes) {
    tableNames.add(change.tableName);
  }
  return tableNames;
}

/**
 * Get the set of table names to be deleted by a migration. A renamed table's
 * old name is included: the old table survives the Pre-phase and the script
 * (which copies its rows into the new table), then is dropped here.
 * @param {PendingMigration} migration - Pending migration
 * @returns {Set<string>} Set of table names to delete
 */
export function getDeletedTableNames(migration: PendingMigration): Set<string> {
  const tableNames = new Set<string>();
  for (const change of migration.diff.changes) {
    if (change.kind === "table_removed") {
      tableNames.add(change.tableName);
    } else if (change.kind === "table_renamed") {
      tableNames.add(change.previousTableName);
    }
  }
  return tableNames;
}

/**
 * Key a table by its namespace, since table names are only unique within one.
 * @param namespaceName - Namespace of the table
 * @param tableName - Table name
 * @returns Namespace-qualified table key
 */
export function namespacedTableKey(namespaceName: string, tableName: string): string {
  return `${namespaceName}/${tableName}`;
}

function entriesOfNamespace<T extends { request: { namespaceName?: string } }>(
  entries: readonly T[],
  namespaceName: string,
): T[] {
  return entries.filter((entry) => entry.request.namespaceName === namespaceName);
}

/**
 * How to undo the GraphQL permission a migration's Pre-phase wrote for a table:
 * restore `previous`, or delete the permission when there was none before.
 */
export type GqlPermissionUndo = Map<string, GqlPermissionUndoEntry>;

type GqlPermissionUndoEntry = {
  previous?: NonNullable<
    TailorDBChangeSet["gqlPermission"]["updates"][number]["previousPermission"]
  >;
};

/**
 * Track which tables have been created/updated across migrations, keyed by
 * {@link namespacedTableKey}
 */
export const processedTables = {
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
export const migrationSnapshotCache = {
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
        throw CLIError({
          code: "MIGRATION_HISTORY_INVALID",
          message: `Cannot reconstruct snapshot for ${migration.namespace} migration ${migration.number}: no migrations found in ${migration.migrationsDir}`,
        });
      }
      snapshot = reconstructed;
      this.cache.set(key, snapshot);
    }
    return snapshot;
  },
};

/** How the migration phases of one deploy write table settings. */
export type MigrationPhaseSettings = {
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>;
  /** Tables an enabled executor in this deploy subscribes to */
  executorUsedTables: ReadonlySet<string>;
  /** Whether the migrating namespaces are in maintenance mode */
  restricted: boolean;
};

/**
 * Generate the manifest a migration phase writes for a snapshot table.
 * @param snapshotType - Snapshot table to write
 * @param namespaceName - Namespace of the table
 * @param phaseSettings - How this deploy's migration phases write table settings
 * @returns Table manifest
 */
export function generateMigrationPhaseManifest(
  snapshotType: TailorDBSnapshotType,
  namespaceName: string,
  phaseSettings: MigrationPhaseSettings,
): MessageInitShape<typeof TailorDBTypeSchema> {
  const namespaceGqlOperations = phaseSettings.tailorDBInputs.find(
    (input) => input.namespace === namespaceName,
  )?.config.gqlOperations;
  if (phaseSettings.restricted) {
    // Overrides a declared `publishEvents: true`, which `subscribed` cannot.
    return generateTailorDBTypeManifestFromSnapshot(snapshotType, {
      suppressRecordEvents: true,
      suppressGqlMutations: true,
      namespaceGqlOperations,
    });
  }
  // A checkpoint may opt out of publishing that a later migration in this
  // deploy turns back on for a subscribing executor.
  return generateTailorDBTypeManifestFromSnapshot(snapshotType, {
    subscribed:
      snapshotType.settings?.publishEvents !== false &&
      phaseSettings.executorUsedTables.has(snapshotType.name),
    namespaceGqlOperations,
  });
}

function buildSnapshotTypeManifest(
  migration: PendingMigration,
  tableName: string,
  phaseSettings: MigrationPhaseSettings,
  typeChanges?: Map<string, FieldDiffChange>,
): MessageInitShape<typeof TailorDBTypeSchema> | undefined {
  const snapshot = migrationSnapshotCache.load(migration);
  const snapshotType = snapshot.tables[tableName];
  if (!snapshotType) return undefined;
  const typeScriptsChange = migration.diff.changes.find(
    (change): change is TableScriptsModifiedChange =>
      change.kind === "table_scripts_modified" && change.tableName === tableName,
  );
  const manifestSnapshotType = typeChanges
    ? createPreMigrationSnapshotType(snapshotType, typeChanges, typeScriptsChange)
    : snapshotType;
  return generateMigrationPhaseManifest(manifestSnapshotType, migration.namespace, phaseSettings);
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
  const results = await Promise.allSettled(
    promises.filter((promise): promise is Promise<unknown> => promise !== undefined),
  );
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
 * @param phaseSettings - How this deploy's migration phases write table settings
 * @param attemptedTables - Tables whose schema this migration attempted to create or update
 * @param gqlPermissionUndo - Records how to undo each GraphQL permission this migration writes
 * @returns {Promise<void>} Promise that resolves when pre-migration phase completes
 */
export async function executeSingleMigrationPrePhase(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  migration: PendingMigration,
  phaseSettings: MigrationPhaseSettings,
  attemptedTables: Set<string>,
  gqlPermissionUndo: GqlPermissionUndo,
): Promise<void> {
  // Build pre-migration changes maps for this single migration. Includes both
  // breaking changes (required-add, unique-add, enum value removal) and the
  // warning-tier field_removed, since the Pre-phase relaxes both, plus the
  // breaking table-level index changes.
  const preMigrationChanges = buildPreMigrationChangesMap([migration]);
  const preMigrationIndexChanges = buildPreMigrationIndexChangesMap([migration]);
  const affectedTables = getAffectedTableNames(migration);
  const tableKey = (tableName: string) => namespacedTableKey(migration.namespace, tableName);
  const typeCreates = entriesOfNamespace(changeSet.type.creates, migration.namespace);
  const typeUpdates = entriesOfNamespace(changeSet.type.updates, migration.namespace);
  const createdBeforeMigration = new Set(processedTables.created);

  for (const create of typeCreates) {
    const tableName = create.request.tailordbType?.name;
    if (
      !tableName ||
      !affectedTables.has(tableName) ||
      createdBeforeMigration.has(tableKey(tableName))
    ) {
      continue;
    }
    const typeChanges = preMigrationChanges.get(tableName);
    const snapshotType = buildSnapshotTypeManifest(
      migration,
      tableName,
      phaseSettings,
      typeChanges,
    );
    if (!snapshotType) continue;

    const clonedRequest = structuredClone(create.request);
    clonedRequest.tailordbType = snapshotType;

    if (typeChanges && typeChanges.size > 0 && clonedRequest.tailordbType.schema?.fields) {
      applyPreMigrationFieldAdjustments(clonedRequest.tailordbType.schema.fields, typeChanges);
    }
    const indexChanges = preMigrationIndexChanges.get(tableName);
    if (indexChanges && indexChanges.size > 0 && clonedRequest.tailordbType.schema?.indexes) {
      applyPreMigrationIndexAdjustments(clonedRequest.tailordbType.schema.indexes, indexChanges);
    }

    processedTables.created.add(tableKey(tableName));
    attemptedTables.add(tableName);
    await client.createTailorDBType(clonedRequest);
  }

  for (const create of typeCreates) {
    const tableName = create.request.tailordbType?.name;
    if (
      !tableName ||
      !affectedTables.has(tableName) ||
      !createdBeforeMigration.has(tableKey(tableName))
    ) {
      continue;
    }
    const typeChanges = preMigrationChanges.get(tableName);
    const snapshotType = buildSnapshotTypeManifest(
      migration,
      tableName,
      phaseSettings,
      typeChanges,
    );
    if (!snapshotType) continue;

    const clonedTypeRequest = structuredClone(snapshotType);
    if (typeChanges && typeChanges.size > 0 && clonedTypeRequest.schema?.fields) {
      applyPreMigrationFieldAdjustments(clonedTypeRequest.schema.fields, typeChanges);
    }
    const indexChanges = preMigrationIndexChanges.get(tableName);
    if (indexChanges && indexChanges.size > 0 && clonedTypeRequest.schema?.indexes) {
      applyPreMigrationIndexAdjustments(clonedTypeRequest.schema.indexes, indexChanges);
    }

    processedTables.updated.add(tableKey(tableName));
    attemptedTables.add(tableName);
    await client.updateTailorDBType({
      workspaceId: create.request.workspaceId,
      namespaceName: create.request.namespaceName,
      tailordbType: clonedTypeRequest,
    });
  }

  for (const update of typeUpdates) {
    const tableName = update.request.tailordbType?.name;
    if (!tableName || !affectedTables.has(tableName)) continue;
    const typeChanges = preMigrationChanges.get(tableName);
    const snapshotType = buildSnapshotTypeManifest(
      migration,
      tableName,
      phaseSettings,
      typeChanges,
    );
    if (!snapshotType) continue;

    const clonedRequest = structuredClone(update.request);
    clonedRequest.tailordbType = snapshotType;

    if (typeChanges && typeChanges.size > 0 && clonedRequest.tailordbType.schema?.fields) {
      applyPreMigrationFieldAdjustments(clonedRequest.tailordbType.schema.fields, typeChanges);
    }
    const indexChanges = preMigrationIndexChanges.get(tableName);
    if (indexChanges && indexChanges.size > 0 && clonedRequest.tailordbType.schema?.indexes) {
      applyPreMigrationIndexAdjustments(clonedRequest.tailordbType.schema.indexes, indexChanges);
    }

    processedTables.updated.add(tableKey(tableName));
    attemptedTables.add(tableName);
    await client.updateTailorDBType(clonedRequest);
  }

  const currentTableNames = new Set(Object.keys(migrationSnapshotCache.load(migration).tables));
  const gqlPermissionCreatesForNamespace = entriesOfNamespace(
    changeSet.gqlPermission.creates,
    migration.namespace,
  ).filter(
    (create) =>
      currentTableNames.has(create.name) &&
      !processedTables.gqlPermissionsProcessed.has(tableKey(create.name)),
  );
  const gqlPermissionUpdatesForNamespace = entriesOfNamespace(
    changeSet.gqlPermission.updates,
    migration.namespace,
  ).filter(
    (update) =>
      currentTableNames.has(update.name) &&
      !processedTables.gqlPermissionsProcessed.has(tableKey(update.name)),
  );
  if (gqlPermissionCreatesForNamespace.length + gqlPermissionUpdatesForNamespace.length > 0) {
    const gqlPermissionTypeNames = new Set(
      gqlPermissionCreatesForNamespace.map((create) => create.name),
    );
    const missingTypeCreates = typeCreates.filter((create) => {
      const tableName = create.request.tailordbType?.name;
      return (
        tableName &&
        gqlPermissionTypeNames.has(tableName) &&
        !processedTables.created.has(tableKey(tableName))
      );
    });
    if (missingTypeCreates.length > 0) {
      for (const create of missingTypeCreates) {
        const tableName = create.request.tailordbType?.name;
        if (!tableName) continue;
        const snapshotType = buildSnapshotTypeManifest(migration, tableName, phaseSettings);
        if (!snapshotType) continue;
        processedTables.created.add(tableKey(tableName));
        attemptedTables.add(tableName);
        const clonedRequest = structuredClone(create.request);
        clonedRequest.tailordbType = snapshotType;
        await client.createTailorDBType(clonedRequest);
      }
    }
    for (const create of gqlPermissionCreatesForNamespace) {
      gqlPermissionUndo.set(create.name, {});
    }
    for (const update of gqlPermissionUpdatesForNamespace) {
      if (update.previousPermission) {
        gqlPermissionUndo.set(update.name, { previous: update.previousPermission });
      }
    }
    await awaitAllSettledOrThrow([
      ...gqlPermissionCreatesForNamespace.map((create) =>
        client.createTailorDBGQLPermission(create.request),
      ),
      ...gqlPermissionUpdatesForNamespace.map((update) =>
        client.updateTailorDBGQLPermission(update.request),
      ),
    ]);
    for (const typeName of [
      ...gqlPermissionCreatesForNamespace.map((create) => create.name),
      ...gqlPermissionUpdatesForNamespace.map((update) => update.name),
    ]) {
      processedTables.gqlPermissionsProcessed.add(tableKey(typeName));
    }
  }
}

/**
 * Track which tables/permissions have been deleted across migrations, keyed by
 * {@link namespacedTableKey}
 */
export const deletedResources = {
  types: new Set<string>(),
  gqlPermissions: new Set<string>(),
  reset() {
    this.types.clear();
    this.gqlPermissions.clear();
  },
};

/** What a rollback could not revert, by kind. */
export interface RollbackLeftovers {
  /** Tables whose schema the rollback could not revert. */
  tables: string[];
  /** Tables whose GraphQL permission the rollback could not revert. */
  permissions: string[];
}

/**
 * Derive how to undo a migration's GraphQL permission changes from its snapshots, for a
 * run whose Pre-phase an earlier deploy wrote and so left no undo record in this one.
 * @param migration - The migration to roll back
 * @returns Per table, the permission of the prior checkpoint, or none when it had none
 */
export function gqlPermissionUndoFromSnapshots(migration: PendingMigration): GqlPermissionUndo {
  const undo: GqlPermissionUndo = new Map();
  if (migration.number <= INITIAL_SCHEMA_NUMBER) return undo;
  const priorSnapshot = reconstructSnapshotFromMigrations(
    migration.migrationsDir,
    migration.number - 1,
  );
  if (!priorSnapshot) return undo;
  const currentTables = migrationSnapshotCache.load(migration).tables;
  for (const [tableName, priorTable] of Object.entries(priorSnapshot.tables)) {
    const currentTable = currentTables[tableName];
    if (!currentTable) continue;
    if (isDeepStrictEqual(priorTable.permissions?.gql, currentTable.permissions?.gql)) continue;
    undo.set(
      tableName,
      priorTable.permissions?.gql
        ? { previous: protoGqlPermission(priorTable.permissions.gql) }
        : {},
    );
  }
  return undo;
}

/**
 * Roll a failed migration's Pre-phase back, logging what could not be reverted.
 * Whether the tables it names stay restricted is for the caller to report once
 * restoration has had its chance to lift them.
 * @param client - Operator client instance
 * @param migration - The failed migration
 * @param workspaceId - Workspace ID
 * @param phaseSettings - How this deploy's migration phases write table settings
 * @param attemptedTables - Tables the migration's phases touched
 * @param gqlPermissionUndo - How to undo each GraphQL permission this migration wrote
 * @returns What the rollback could not revert
 */
export async function rollbackSingleMigrationAfterFailure(
  client: OperatorClient,
  migration: PendingMigration,
  workspaceId: string,
  phaseSettings: MigrationPhaseSettings,
  attemptedTables: ReadonlySet<string>,
  gqlPermissionUndo: GqlPermissionUndo,
): Promise<RollbackLeftovers> {
  const migrationLabel = `${migration.namespace}/${formatMigrationNumber(migration.number)}`;
  let leftovers: RollbackLeftovers;
  try {
    leftovers = await rollbackSingleMigrationPrePhase(
      client,
      migration,
      workspaceId,
      phaseSettings,
      attemptedTables,
      gqlPermissionUndo,
    );
  } catch (rollbackError) {
    logger.warn(
      `Failed to roll back migration ${migrationLabel}: ` +
        `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
    );
    leftovers = { tables: [...attemptedTables], permissions: [...gqlPermissionUndo.keys()] };
  }
  return leftovers;
}

/**
 * Execute post-migration phase for a single migration: Apply final tables (with required: true)
 * @param {OperatorClient} client - Operator client instance
 * @param {TailorDBChangeSet} changeSet - TailorDB change set
 * @param {PendingMigration} migration - Single pending migration
 * @param phaseSettings - How this deploy's migration phases write table settings
 * @param attemptedTables - Tables whose schema this migration attempted to create or update
 * @returns {Promise<void>} Promise that resolves when post-migration phase completes
 */
export async function executeSingleMigrationPostPhase(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  migration: PendingMigration,
  phaseSettings: MigrationPhaseSettings,
  attemptedTables: Set<string>,
): Promise<void> {
  // Re-use the pre-migration changes maps to know which tables were touched in
  // this migration (so we send the post-phase final-schema update for them).
  const preMigrationChanges = buildPreMigrationChangesMap([migration]);
  const preMigrationIndexChanges = buildPreMigrationIndexChangesMap([migration]);
  const adjustedTypes = new Set([
    ...preMigrationChanges.keys(),
    ...preMigrationIndexChanges.keys(),
  ]);
  const affectedTables = getAffectedTableNames(migration);

  // Tables - apply schema as of migration N (= snapshot[N]) with all breaking
  // changes enforced. The prePhase sent the same schema with breaking fields
  // relaxed; here we send it again without relaxation so required/unique/etc.
  // take effect after the data script has reconciled records.
  try {
    // For newly created tables that had pre-migration adjustments in this migration, send update with snapshot[N] values
    for (const create of entriesOfNamespace(changeSet.type.creates, migration.namespace)) {
      const tableName = create.request.tailordbType?.name;
      if (!tableName || !affectedTables.has(tableName) || !adjustedTypes.has(tableName)) {
        continue;
      }
      const snapshotType = buildSnapshotTypeManifest(migration, tableName, phaseSettings);
      if (!snapshotType) continue;
      attemptedTables.add(tableName);
      await client.updateTailorDBType({
        workspaceId: create.request.workspaceId,
        namespaceName: create.request.namespaceName,
        tailordbType: snapshotType,
      });
    }

    // For updated tables affected by this migration, send update with snapshot[N] values
    for (const update of entriesOfNamespace(changeSet.type.updates, migration.namespace)) {
      const tableName = update.request.tailordbType?.name;
      if (!tableName || !affectedTables.has(tableName) || !adjustedTypes.has(tableName)) {
        continue;
      }
      const snapshotType = buildSnapshotTypeManifest(migration, tableName, phaseSettings);
      if (!snapshotType) continue;
      attemptedTables.add(tableName);
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
}

/**
 * Rewrite tables that can publish records or accept GraphQL mutations, with
 * migration restrictions applied or removed from the given snapshot.
 *
 * Writes the snapshot's schema rather than the config's, so this never enforces
 * a change whose migration has not run — the same reason the per-migration
 * phases build from a checkpoint.
 * @param client - Operator client instance
 * @param params - Namespace, snapshot, subscriber set, and direction
 */
type RewriteRestrictedTablesParams = {
  workspaceId: string;
  namespaceName: string;
  snapshot: SchemaSnapshot;
  input: TailorDBDeployInput;
  executorUsedTables: ReadonlySet<string>;
  settingsState?: ReadonlyMap<string, MigrationTableSettings>;
  restricted: boolean;
  continueOnError?: boolean;
};

export function acceptsMigrationWrites(settings: MigrationTableSettings): boolean {
  const operations = settings.disableGqlOperations;
  return (
    settings.publishRecordEvents ||
    settings.bulkUpsert ||
    operations?.create !== true ||
    operations.update !== true ||
    operations.delete !== true
  );
}

type RestrictedTablesRewrite = { failedTables: string[]; firstError?: Error };

/** Tables of one namespace that kept their migration restrictions. */
export type RestrictedTables = { namespace: string; tables: string[] };

export const RESTRICTION_EFFECT =
  "the GraphQL create, update, and delete operations and bulk upsert are disabled, and record events are not published";

const RESTRICTED_TABLES_RECOVERY =
  "Deploy again: once it finishes, the deploy writes the tables' configured settings back.";

export const ROLLBACK_LEFTOVER_RECOVERY =
  "Check these tables in the workspace and delete or repair them by hand. A deploy that finds a table the migration history does not know stops with remote schema drift, so deploying again does not release them.";

interface LeftRestrictedOptions {
  /** How the tables are released. */
  recovery?: string;
  /** Whether tables stay restricted although none of them can be named. */
  namesUnknown?: boolean;
}

/**
 * Warn about tables that keep their migration restrictions, and how they are released.
 * @param reason - What left the tables restricted
 * @param restricted - The tables, by namespace
 * @param options - How the tables are released, and whether their names are unknown
 */
export function warnTablesLeftRestricted(
  reason: string,
  restricted: readonly RestrictedTables[],
  options: LeftRestrictedOptions = {},
): void {
  const { recovery = RESTRICTED_TABLES_RECOVERY, namesUnknown = false } = options;
  const tables = restricted.filter((entry) => entry.tables.length > 0);
  if (tables.length === 0) {
    logger.warn(reason);
    if (namesUnknown) logger.log(recovery);
    return;
  }
  logger.warn(
    `${reason} Still restricted (${RESTRICTION_EFFECT}): ` +
      `${tables.map((entry) => `namespace '${entry.namespace}': ${entry.tables.join(", ")}`).join("; ")}.`,
  );
  logger.log(recovery);
}

async function rewriteRestrictedTables(
  client: OperatorClient,
  params: RewriteRestrictedTablesParams,
): Promise<RestrictedTablesRewrite> {
  const {
    workspaceId,
    namespaceName,
    snapshot,
    input,
    executorUsedTables,
    settingsState,
    restricted,
    continueOnError = false,
  } = params;
  const phaseSettings: MigrationPhaseSettings = {
    tailorDBInputs: [input],
    executorUsedTables,
    restricted,
  };
  let firstError: Error | undefined;
  const failedTables: string[] = [];
  const tableNames = new Set([...Object.keys(snapshot.tables), ...(settingsState?.keys() ?? [])]);
  for (const tableName of tableNames) {
    try {
      const snapshotType = snapshot.tables[tableName];
      const activeSettings = settingsState?.get(tableName);
      if (settingsState && !activeSettings) continue;
      if (restricted && (!activeSettings || isMigrationRestricted(activeSettings))) continue;
      const tailordbType = snapshotType
        ? generateMigrationPhaseManifest(snapshotType, namespaceName, phaseSettings)
        : activeSettings?.tailordbType
          ? structuredClone(activeSettings.tailordbType)
          : undefined;
      if (!tailordbType?.schema) continue;
      tailordbType.schema.settings ??= {};
      const settings = tailordbType.schema.settings;
      if (restricted) {
        settings.bulkUpsert = false;
        settings.publishRecordEvents = false;
        settings.disableGqlOperations = {
          create: true,
          update: true,
          delete: true,
          read: activeSettings?.disableGqlOperations?.read ?? false,
        };
      }
      if (!restricted && activeSettings) {
        settings.bulkUpsert = activeSettings.bulkUpsert;
        settings.publishRecordEvents = activeSettings.publishRecordEvents;
        settings.disableGqlOperations = activeSettings.disableGqlOperations
          ? { ...activeSettings.disableGqlOperations }
          : undefined;
      }
      await client.updateTailorDBType({ workspaceId, namespaceName, tailordbType });
    } catch (error) {
      if (!continueOnError) throw error;
      failedTables.push(tableName);
      firstError ??= error instanceof Error ? error : toError(error);
    }
  }
  return { failedTables, firstError };
}

/**
 * Resolve the settings represented by a committed migration snapshot.
 *
 * Intermediate snapshots may intentionally conflict with executors from the
 * final deployment. They still need restorable settings if a later migration
 * fails, so explicit snapshot values win without re-running that final-state
 * conflict check.
 * @param snapshot - Committed schema snapshot
 * @param input - TailorDB deploy input for the namespace
 * @param executorUsedTables - Tables an enabled executor in this deploy subscribes to
 * @returns Settings keyed by table name
 */
export function resolveMigrationSnapshotSettings(
  snapshot: SchemaSnapshot,
  input: TailorDBDeployInput,
  executorUsedTables: ReadonlySet<string>,
): Map<string, MigrationTableSettings> {
  const settingsByTable = new Map<string, MigrationTableSettings>();
  for (const [tableName, snapshotType] of Object.entries(snapshot.tables)) {
    const settings = generateTailorDBTypeManifestFromSnapshot(snapshotType, {
      subscribed: false,
      namespaceGqlOperations: input.config.gqlOperations,
    }).schema?.settings;
    if (!settings) continue;
    settingsByTable.set(tableName, {
      bulkUpsert: settings.bulkUpsert ?? false,
      publishRecordEvents:
        snapshotType.settings?.publishEvents ?? executorUsedTables.has(tableName),
      ...(settings.disableGqlOperations && {
        disableGqlOperations: {
          create: settings.disableGqlOperations.create ?? false,
          update: settings.disableGqlOperations.update ?? false,
          delete: settings.disableGqlOperations.delete ?? false,
          read: settings.disableGqlOperations.read ?? false,
        },
      }),
    });
  }
  return settingsByTable;
}

/**
 * Replace the captured settings of checkpoint tables that an interrupted
 * deploy left in maintenance mode with the checkpoint's own settings, so this
 * deploy releases them even if its migrations fail.
 * @param capturedSettings - Settings captured before this deploy's migrations, keyed by table name
 * @param snapshot - Schema of the checkpoint the maintenance-mode record names
 * @param input - TailorDB deploy input for the namespace
 * @param executorUsedTables - Tables an enabled executor in this deploy subscribes to
 * @returns Settings keyed by table name
 */
export function releaseRecordedMaintenanceMode(
  capturedSettings: ReadonlyMap<string, MigrationTableSettings>,
  snapshot: SchemaSnapshot,
  input: TailorDBDeployInput,
  executorUsedTables: ReadonlySet<string>,
): Map<string, MigrationTableSettings> {
  const checkpointSettings = resolveMigrationSnapshotSettings(snapshot, input, executorUsedTables);
  return new Map(
    [...capturedSettings].map(([tableName, settings]) => {
      const released = checkpointSettings.get(tableName);
      return [tableName, released && isMigrationRestricted(settings) ? released : settings];
    }),
  );
}

/**
 * Stop record event publishing and GraphQL mutations across each migrating namespace.
 *
 * The per-migration phases only rewrite tables some pending diff names, so a
 * data-only migration — an empty diff carrying only a script — would leave the
 * whole namespace unrestricted while its script runs. Restrictions therefore
 * use the schema in place before the namespace's first migration.
 * @param client - Operator client instance
 * @param snapshots - Schema in place before each namespace's first pending migration
 * @param restrictionState - Settings and tables active before migration writes
 * @param tailorDBInputs - TailorDB deploy inputs for the run
 * @param executorUsedTables - Tables an enabled executor subscribes to
 * @param workspaceId - Target workspace ID
 */
export async function applyMigrationRestrictions(
  client: OperatorClient,
  snapshots: ReadonlyMap<string, SchemaSnapshot>,
  restrictionState: MigrationRestrictionState,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  executorUsedTables: ReadonlySet<string>,
  workspaceId: string,
): Promise<void> {
  for (const [namespaceName, snapshot] of snapshots) {
    const input = tailorDBInputs.find((entry) => entry.namespace === namespaceName);
    if (!input) continue;
    await rewriteRestrictedTables(client, {
      workspaceId,
      namespaceName,
      snapshot,
      input,
      executorUsedTables,
      settingsState: restrictionState.get(namespaceName) ?? new Map(),
      restricted: true,
    });
  }
}

/**
 * Restore normal event publishing and GraphQL operations after migrations.
 *
 * Uses the latest schema that completed its post-phase in each namespace. If a
 * later migration fails, this avoids applying schema changes that never settled.
 *
 * Callers must run this even when the migration loop throws because a committed
 * checkpoint drops its migration from the next run's pending set.
 * @param client - Operator client instance
 * @param snapshots - Latest schema that settled in each migrating namespace
 * @param settingsToRestore - Settings for the latest confirmed checkpoint, including exact active settings for snapshot-external tables
 * @param tailorDBInputs - TailorDB deploy inputs for the run
 * @param executorUsedTables - Tables an enabled executor subscribes to
 * @param workspaceId - Target workspace ID
 * @param maintenanceMode - Whether this deploy restricted the migrating namespaces
 */
export async function restoreMigrationRestrictions(
  client: OperatorClient,
  snapshots: ReadonlyMap<string, SchemaSnapshot>,
  settingsToRestore: MigrationRestrictionState | undefined,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  executorUsedTables: ReadonlySet<string>,
  workspaceId: string,
  maintenanceMode: boolean,
): Promise<void> {
  let firstError: Error | undefined;
  const unrestored: RestrictedTables[] = [];
  for (const [namespaceName, snapshot] of snapshots) {
    const input = tailorDBInputs.find((entry) => entry.namespace === namespaceName);
    if (!input) continue;
    try {
      const rewrite = await rewriteRestrictedTables(client, {
        workspaceId,
        namespaceName,
        snapshot,
        input,
        executorUsedTables,
        settingsState: settingsToRestore?.get(namespaceName),
        restricted: false,
        continueOnError: true,
      });
      if (rewrite.firstError) {
        firstError ??= rewrite.firstError;
        unrestored.push({ namespace: namespaceName, tables: rewrite.failedTables });
      }
    } catch (error) {
      firstError ??= error instanceof Error ? error : toError(error);
      unrestored.push({ namespace: namespaceName, tables: [] });
    }
  }
  if (firstError !== undefined) {
    const carried = getErrorDiagnostics(firstError);
    throw withErrorDiagnostics(firstError, {
      code: "MIGRATION_RESTORE_FAILED",
      suggestion: [
        maintenanceMode
          ? `${RESTRICTED_TABLES_RECOVERY} Tables that stay restricted: ${describeUnrestored(unrestored)}.`
          : `Tables whose settings could not be restored: ${describeUnrestored(unrestored)}. Check these tables in the workspace and repair their settings before retrying the deployment.`,
        carried.suggestion,
      ]
        .filter(Boolean)
        .join(" "),
      context: { ...carried.context, unrestored },
    });
  }
}

/**
 * List the tables that restoring could not release, as `restoreMigrationRestrictions` reports them.
 * @param error - Error thrown by `restoreMigrationRestrictions`
 * @returns Tables that stay restricted, by namespace
 */
export function readUnrestoredTables(error: unknown): RestrictedTables[] {
  if (!(error instanceof Error)) return [];
  const unrestored = getErrorDiagnostics(error).context?.unrestored;
  return Array.isArray(unrestored) ? (unrestored as RestrictedTables[]) : [];
}

function describeUnrestored(unrestored: readonly RestrictedTables[]): string {
  return unrestored
    .map((entry) => `namespace '${entry.namespace}': ${entry.tables.join(", ") || "(unknown)"}`)
    .join("; ");
}

export async function executeSingleMigrationPostPhaseDeletions(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  migration: PendingMigration,
): Promise<void> {
  const deletedTableNames = getDeletedTableNames(migration);
  if (deletedTableNames.size > 0) {
    const tableKey = (tableName: string) => namespacedTableKey(migration.namespace, tableName);
    const gqlPermissionsToDelete = entriesOfNamespace(
      changeSet.gqlPermission.deletes,
      migration.namespace,
    ).filter(
      (del) =>
        deletedTableNames.has(del.name) && !deletedResources.gqlPermissions.has(tableKey(del.name)),
    );
    for (const del of gqlPermissionsToDelete) {
      await client.deleteTailorDBGQLPermission(del.request);
      deletedResources.gqlPermissions.add(tableKey(del.name));
    }

    const typesToDelete = entriesOfNamespace(changeSet.type.deletes, migration.namespace).filter(
      (del) => deletedTableNames.has(del.name) && !deletedResources.types.has(tableKey(del.name)),
    );
    for (const del of typesToDelete) {
      await client.deleteTailorDBType(del.request);
      deletedResources.types.add(tableKey(del.name));
    }
  }
}

/**
 * Revert a single migration's Pre-phase DDL to the prior checkpoint's schema.
 * @param client - Operator client instance
 * @param migration - The migration whose Pre-phase DDL must be reverted
 * @param workspaceId - Workspace ID
 * @param phaseSettings - How this deploy's migration phases write table settings
 * @param attemptedTables - Tables whose schema this migration attempted to create or update
 * @param gqlPermissionUndo - How to undo each GraphQL permission this migration wrote
 * @returns What the rollback could not revert
 */
async function rollbackSingleMigrationPrePhase(
  client: OperatorClient,
  migration: PendingMigration,
  workspaceId: string,
  phaseSettings: MigrationPhaseSettings,
  attemptedTables: ReadonlySet<string>,
  gqlPermissionUndo: GqlPermissionUndo,
): Promise<RollbackLeftovers> {
  // The baseline migration has no prior checkpoint to revert to.
  if (migration.number <= INITIAL_SCHEMA_NUMBER) {
    return { tables: [...attemptedTables], permissions: [] };
  }
  if (attemptedTables.size === 0 && gqlPermissionUndo.size === 0) {
    return { tables: [], permissions: [] };
  }

  const priorSnapshot = reconstructSnapshotFromMigrations(
    migration.migrationsDir,
    migration.number - 1,
  );
  // Without the prior snapshot, pre-existing and new tables are indistinguishable;
  // deleting them all would be destructive, so leave the schema untouched.
  if (!priorSnapshot) {
    logger.warn(
      `Cannot roll back migration ${migration.namespace}/${formatMigrationNumber(migration.number)}: ` +
        `prior snapshot (migration ${formatMigrationNumber(migration.number - 1)}) could not be reconstructed. ` +
        "Leaving schema as-is; manual repair may be required.",
    );
    return { tables: [...attemptedTables], permissions: [...gqlPermissionUndo.keys()] };
  }
  logger.warn(
    `Migration ${migration.namespace}/${formatMigrationNumber(migration.number)} failed; ` +
      "rolling back its pre-migration schema changes.",
  );

  // Restore pre-existing tables before deleting new ones, so no restored table
  // still references a new table (e.g. a foreign key retargeted at a renamed
  // table) at the moment that table is deleted.
  const restoredTables = [...attemptedTables].flatMap((tableName) => {
    const priorTable = priorSnapshot.tables[tableName];
    return priorTable ? [{ tableName, priorTable }] : [];
  });
  const newTables = [...attemptedTables].filter((tableName) => !priorSnapshot.tables[tableName]);
  const leftRestricted: string[] = [];
  const leftPermissions: string[] = [];
  for (const { tableName, priorTable } of restoredTables) {
    try {
      const manifest = generateMigrationPhaseManifest(
        priorTable,
        migration.namespace,
        phaseSettings,
      );
      await client.updateTailorDBType({
        workspaceId,
        namespaceName: migration.namespace,
        tailordbType: manifest,
      });
    } catch (rollbackError) {
      leftRestricted.push(tableName);
      logger.warn(
        `Failed to roll back table '${tableName}' in namespace '${migration.namespace}': ` +
          `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }
  }

  for (const [tableName, undo] of gqlPermissionUndo) {
    if (!priorSnapshot.tables[tableName]) continue;
    try {
      await restoreGqlPermission(client, workspaceId, migration.namespace, tableName, undo);
    } catch (rollbackError) {
      leftPermissions.push(tableName);
      logger.warn(
        `Failed to roll back the GraphQL permission of table '${tableName}' in namespace '${migration.namespace}': ` +
          `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }
  }

  for (const tableName of newTables) {
    try {
      // New table: its GQL permission must go first (table deletion does not
      // cascade). The permission may not exist, so the delete is best-effort.
      await client
        .deleteTailorDBGQLPermission({
          workspaceId,
          namespaceName: migration.namespace,
          typeName: tableName,
        })
        .catch(() => undefined);
      await client.deleteTailorDBType({
        workspaceId,
        namespaceName: migration.namespace,
        tailordbTypeName: tableName,
      });
    } catch (rollbackError) {
      if (isNotFoundError(rollbackError)) continue;
      leftRestricted.push(tableName);
      logger.warn(
        `Failed to roll back table '${tableName}' in namespace '${migration.namespace}': ` +
          `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }
  }
  return { tables: [...new Set(leftRestricted)], permissions: [...new Set(leftPermissions)] };
}

async function restoreGqlPermission(
  client: OperatorClient,
  workspaceId: string,
  namespaceName: string,
  tableName: string,
  undo: GqlPermissionUndoEntry,
): Promise<void> {
  const target = { workspaceId, namespaceName, typeName: tableName };
  if (!undo.previous) {
    await client.deleteTailorDBGQLPermission(target).catch((error: unknown) => {
      if (!isNotFoundError(error)) throw error;
    });
    return;
  }
  try {
    await client.updateTailorDBGQLPermission({ ...target, permission: undo.previous });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    await client.createTailorDBGQLPermission({ ...target, permission: undo.previous });
  }
}
