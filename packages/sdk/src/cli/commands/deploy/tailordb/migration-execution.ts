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
  type SchemaSnapshot,
  type TailorDBSnapshotType,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { generateTailorDBTypeManifestFromSnapshot } from "#/cli/commands/tailordb/migrate/snapshot-manifest";
import { handleOptionalToRequiredError } from "#/cli/commands/tailordb/migrate/types";
import { logger } from "#/cli/shared/logger";
import { publishEventsConflict, resolvePublishEvents } from "#/cli/shared/publish-events";
import type {
  FieldDiffChange,
  TableScriptsModifiedChange,
} from "#/cli/commands/tailordb/migrate/diff-calculator";
import type { TailorDBDeployInput } from "#/cli/commands/tailordb/migrate/schema-checks";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { OperatorClient } from "#/cli/shared/client";
import type { TailorDBChangeSet } from "./plan";
import type { TailorDBTypeSchema } from "@tailor-platform/tailor-proto/tailordb_resource_pb";

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
 * Track which tables have been created/updated across migrations
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
  tableName: string,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  typeChanges?: Map<string, FieldDiffChange>,
): MessageInitShape<typeof TailorDBTypeSchema> | undefined {
  const snapshot = migrationSnapshotCache.load(migration);
  const snapshotType = snapshot.tables[tableName];
  if (!snapshotType) return undefined;
  const input = tailorDBInputs.find((i) => i.namespace === migration.namespace);
  const typeScriptsChange = migration.diff.changes.find(
    (change): change is TableScriptsModifiedChange =>
      change.kind === "table_scripts_modified" && change.tableName === tableName,
  );
  const manifestSnapshotType = typeChanges
    ? createPreMigrationSnapshotType(snapshotType, typeChanges, typeScriptsChange)
    : snapshotType;
  return generateTailorDBTypeManifestFromSnapshot(manifestSnapshotType, {
    // A migration script's own record writes would publish from a shape that is
    // mid-migration, to executors still registered from the previous deploy.
    // `restoreRecordEventPublishing` turns it back on once they have settled.
    // Overrides a declared `publishEvents: true`, which `subscribed` cannot.
    suppressRecordEvents: true,
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
 * @param tailorDBInputs - Deploy inputs, used to resolve namespace gqlOperations for the snapshot
 * @param attemptedTables - Tables whose schema this migration attempted to create or update
 * @returns {Promise<void>} Promise that resolves when pre-migration phase completes
 */
export async function executeSingleMigrationPrePhase(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  migration: PendingMigration,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  attemptedTables: Set<string>,
): Promise<void> {
  // Build pre-migration changes maps for this single migration. Includes both
  // breaking changes (required-add, unique-add, enum value removal) and the
  // warning-tier field_removed, since the Pre-phase relaxes both, plus the
  // breaking table-level index changes.
  const preMigrationChanges = buildPreMigrationChangesMap([migration]);
  const preMigrationIndexChanges = buildPreMigrationIndexChangesMap([migration]);
  const affectedTables = getAffectedTableNames(migration);
  const createdBeforeMigration = new Set(processedTables.created);

  for (const create of changeSet.type.creates) {
    const tableName = create.request.tailordbType?.name;
    if (!tableName || !affectedTables.has(tableName) || createdBeforeMigration.has(tableName)) {
      continue;
    }
    const typeChanges = preMigrationChanges.get(tableName);
    const snapshotType = buildSnapshotTypeManifest(
      migration,
      tableName,
      tailorDBInputs,
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

    processedTables.created.add(tableName);
    attemptedTables.add(tableName);
    await client.createTailorDBType(clonedRequest);
  }

  for (const create of changeSet.type.creates) {
    const tableName = create.request.tailordbType?.name;
    if (!tableName || !affectedTables.has(tableName) || !createdBeforeMigration.has(tableName)) {
      continue;
    }
    const typeChanges = preMigrationChanges.get(tableName);
    const snapshotType = buildSnapshotTypeManifest(
      migration,
      tableName,
      tailorDBInputs,
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

    processedTables.updated.add(tableName);
    attemptedTables.add(tableName);
    await client.updateTailorDBType({
      workspaceId: create.request.workspaceId,
      namespaceName: create.request.namespaceName,
      tailordbType: clonedTypeRequest,
    });
  }

  for (const update of changeSet.type.updates) {
    const tableName = update.request.tailordbType?.name;
    if (!tableName || !affectedTables.has(tableName)) continue;
    const typeChanges = preMigrationChanges.get(tableName);
    const snapshotType = buildSnapshotTypeManifest(
      migration,
      tableName,
      tailorDBInputs,
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

    processedTables.updated.add(tableName);
    attemptedTables.add(tableName);
    await client.updateTailorDBType(clonedRequest);
  }

  // GQLPermissions - process once (on the first migration)
  if (!processedTables.gqlPermissionsProcessed.has(migration.namespace)) {
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
      const tableName = create.request.tailordbType?.name;
      const namespaceName = create.request.namespaceName;
      return (
        namespaceName === migration.namespace &&
        tableName &&
        gqlPermissionTypeNames.has(tableName) &&
        !processedTables.created.has(tableName)
      );
    });
    if (missingTypeCreates.length > 0) {
      for (const create of missingTypeCreates) {
        const tableName = create.request.tailordbType?.name;
        if (tableName) {
          processedTables.created.add(tableName);
          attemptedTables.add(tableName);
        }
        await client.createTailorDBType(create.request);
      }
    }
    processedTables.gqlPermissionsProcessed.add(migration.namespace);
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
 * Track which tables/permissions have been deleted across migrations
 */
export const deletedResources = {
  types: new Set<string>(),
  gqlPermissions: new Set<string>(),
  reset() {
    this.types.clear();
    this.gqlPermissions.clear();
  },
};

export async function rollbackSingleMigrationAfterFailure(
  client: OperatorClient,
  migration: PendingMigration,
  workspaceId: string,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  executorUsedTables: ReadonlySet<string>,
  attemptedTables: ReadonlySet<string>,
): Promise<void> {
  try {
    await rollbackSingleMigrationPrePhase(
      client,
      migration,
      workspaceId,
      tailorDBInputs,
      executorUsedTables,
      attemptedTables,
    );
  } catch (rollbackError) {
    logger.warn(
      `Failed to roll back migration ${migration.namespace}/${formatMigrationNumber(migration.number)}: ` +
        `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
    );
  }
}

/**
 * Execute post-migration phase for a single migration: Apply final tables (with required: true)
 * @param {OperatorClient} client - Operator client instance
 * @param {TailorDBChangeSet} changeSet - TailorDB change set
 * @param {PendingMigration} migration - Single pending migration
 * @param tailorDBInputs - Deploy inputs, used to resolve namespace gqlOperations for the snapshot
 * @param attemptedTables - Tables whose schema this migration attempted to create or update
 * @returns {Promise<void>} Promise that resolves when post-migration phase completes
 */
export async function executeSingleMigrationPostPhase(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  migration: PendingMigration,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
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
    for (const create of changeSet.type.creates) {
      const tableName = create.request.tailordbType?.name;
      if (!tableName || !affectedTables.has(tableName) || !adjustedTypes.has(tableName)) {
        continue;
      }
      const snapshotType = buildSnapshotTypeManifest(migration, tableName, tailorDBInputs);
      if (!snapshotType) continue;
      attemptedTables.add(tableName);
      await client.updateTailorDBType({
        workspaceId: create.request.workspaceId,
        namespaceName: create.request.namespaceName,
        tailordbType: snapshotType,
      });
    }

    // For updated tables affected by this migration, send update with snapshot[N] values
    for (const update of changeSet.type.updates) {
      const tableName = update.request.tailordbType?.name;
      if (!tableName || !affectedTables.has(tableName) || !adjustedTypes.has(tableName)) {
        continue;
      }
      const snapshotType = buildSnapshotTypeManifest(migration, tableName, tailorDBInputs);
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
 * Whether a table publishes record events once the migrations have settled.
 * @param snapshotType - Table as of the snapshot being applied
 * @param subscribed - Whether an enabled executor subscribes to it
 * @returns Whether the table's manifest would enable publishing
 */
function publishesRecordEvents(snapshotType: TailorDBSnapshotType, subscribed: boolean): boolean {
  return resolvePublishEvents({
    explicit: snapshotType.settings?.publishEvents,
    subscribed,
    conflict: publishEventsConflict.tailorDBType(snapshotType.name),
  });
}

/**
 * Rewrite a migrating namespace's publishing tables, with publishing forced off
 * or resolved normally, from the schema of the given snapshot.
 *
 * Writes the snapshot's schema rather than the config's, so this never enforces
 * a change whose migration has not run — the same reason the per-migration
 * phases build from a checkpoint.
 * @param client - Operator client instance
 * @param params - Namespace, snapshot, subscriber set, and direction
 */
async function rewritePublishingTables(
  client: OperatorClient,
  params: {
    workspaceId: string;
    namespaceName: string;
    snapshot: SchemaSnapshot;
    input: TailorDBDeployInput;
    executorUsedTables: ReadonlySet<string>;
    skip: ReadonlySet<string>;
    suppress: boolean;
  },
): Promise<void> {
  const { workspaceId, namespaceName, snapshot, input, executorUsedTables, skip, suppress } =
    params;
  for (const [tableName, snapshotType] of Object.entries(snapshot.tables)) {
    if (skip.has(tableName)) continue;
    // Only a table that would publish is worth rewriting either way.
    if (!publishesRecordEvents(snapshotType, executorUsedTables.has(tableName))) continue;
    await client.updateTailorDBType({
      workspaceId,
      namespaceName,
      tailordbType: generateTailorDBTypeManifestFromSnapshot(snapshotType, {
        ...(suppress
          ? { suppressRecordEvents: true }
          : { subscribed: executorUsedTables.has(tableName) }),
        namespaceGqlOperations: input.config.gqlOperations,
      }),
    });
  }
}

/**
 * The first and last pending migration per namespace, in application order.
 * @param migrations - Pending migrations in the run
 * @returns First and last migration, keyed by namespace
 */
function migrationBounds(
  migrations: ReadonlyArray<PendingMigration>,
): Map<string, { first: PendingMigration; last: PendingMigration }> {
  const bounds = new Map<string, { first: PendingMigration; last: PendingMigration }>();
  for (const migration of migrations) {
    const seen = bounds.get(migration.namespace);
    if (!seen) {
      bounds.set(migration.namespace, { first: migration, last: migration });
      continue;
    }
    if (migration.number < seen.first.number) seen.first = migration;
    if (migration.number > seen.last.number) seen.last = migration;
  }
  return bounds;
}

/**
 * Turn record event publishing off across every migrating namespace.
 *
 * The per-migration phases only rewrite tables some pending diff names, so a
 * data-only migration — an empty diff carrying only a script — would leave the
 * whole namespace publishing while its script runs. Suppression therefore
 * covers the namespace, from the schema in place before its first migration.
 * @param client - Operator client instance
 * @param migrations - Migrations about to be applied
 * @param tailorDBInputs - TailorDB deploy inputs for the run
 * @param executorUsedTables - Tables an enabled executor subscribes to
 * @param workspaceId - Target workspace ID
 */
export async function suppressRecordEventPublishing(
  client: OperatorClient,
  migrations: ReadonlyArray<PendingMigration>,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  executorUsedTables: ReadonlySet<string>,
  workspaceId: string,
): Promise<void> {
  for (const [namespaceName, { first }] of migrationBounds(migrations)) {
    const input = tailorDBInputs.find((entry) => entry.namespace === namespaceName);
    if (!input) continue;
    await rewritePublishingTables(client, {
      workspaceId,
      namespaceName,
      // The state before this namespace's first migration is what that
      // migration's script runs against.
      snapshot: migrationSnapshotCache.load(first),
      input,
      executorUsedTables,
      skip: new Set(),
      suppress: true,
    });
  }
}

/**
 * Turn record event publishing back on for the tables the migrations suppressed.
 *
 * The per-migration phases write last, so their suppressed manifests are the
 * state a deploy would otherwise leave behind: a table that publishes would stay
 * silent until some later deploy happened to rewrite it. Runs on the schema as
 * of each namespace's final migration, which schema verification has already
 * checked reproduces the local definitions.
 *
 * Callers must run this even when the migration loop throws. Publishing left off
 * after an aborted deploy survives the retry, because a committed checkpoint
 * drops its migration from the pending set and the loop never runs again.
 * @param client - Operator client instance
 * @param migrations - Migrations applied in this run
 * @param tailorDBInputs - TailorDB deploy inputs for the run
 * @param executorUsedTables - Tables an enabled executor subscribes to
 * @param workspaceId - Target workspace ID
 */
export async function restoreRecordEventPublishing(
  client: OperatorClient,
  migrations: ReadonlyArray<PendingMigration>,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  executorUsedTables: ReadonlySet<string>,
  workspaceId: string,
): Promise<void> {
  for (const [namespaceName, { last }] of migrationBounds(migrations)) {
    const input = tailorDBInputs.find((entry) => entry.namespace === namespaceName);
    if (!input) continue;
    const dropped = new Set(
      migrations
        .filter((migration) => migration.namespace === namespaceName)
        .flatMap((migration) => [...getDeletedTableNames(migration)]),
    );
    await rewritePublishingTables(client, {
      workspaceId,
      namespaceName,
      snapshot: migrationSnapshotCache.load(last),
      input,
      executorUsedTables,
      // A table the migrations dropped has nothing left to publish from.
      skip: dropped,
      suppress: false,
    });
  }
}

export async function executeSingleMigrationPostPhaseDeletions(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  migration: PendingMigration,
): Promise<void> {
  const deletedTableNames = getDeletedTableNames(migration);
  if (deletedTableNames.size > 0) {
    const gqlPermissionsToDelete = changeSet.gqlPermission.deletes.filter((del) => {
      const permKey = `${del.request.namespaceName}/${del.name}`;
      if (deletedResources.gqlPermissions.has(permKey)) return false;
      const tableName = del.name;
      return deletedTableNames.has(tableName);
    });
    for (const del of gqlPermissionsToDelete) {
      await client.deleteTailorDBGQLPermission(del.request);
      deletedResources.gqlPermissions.add(`${del.request.namespaceName}/${del.name}`);
    }

    const typesToDelete = changeSet.type.deletes.filter((del) => {
      const tableName = del.name;
      if (!tableName || deletedResources.types.has(tableName)) return false;
      return deletedTableNames.has(tableName);
    });
    for (const del of typesToDelete) {
      await client.deleteTailorDBType(del.request);
      deletedResources.types.add(del.name);
    }
  }
}

/**
 * Revert a single migration's Pre-phase DDL to the prior checkpoint's schema.
 * @param client - Operator client instance
 * @param migration - The migration whose Pre-phase DDL must be reverted
 * @param workspaceId - Workspace ID
 * @param tailorDBInputs - Deploy inputs, used to resolve namespace gqlOperations for the snapshot
 * @param executorUsedTables - Tables used by executors (drives publishRecordEvents default)
 * @param attemptedTables - Tables whose schema this migration attempted to create or update
 * @returns {Promise<void>} Promise that resolves when rollback attempts complete
 */
async function rollbackSingleMigrationPrePhase(
  client: OperatorClient,
  migration: PendingMigration,
  workspaceId: string,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  executorUsedTables: ReadonlySet<string>,
  attemptedTables: ReadonlySet<string>,
): Promise<void> {
  // The baseline migration has no prior checkpoint to revert to.
  if (migration.number <= INITIAL_SCHEMA_NUMBER) return;
  if (attemptedTables.size === 0) return;

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
    return;
  }
  const input = tailorDBInputs.find((i) => i.namespace === migration.namespace);

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

  for (const { tableName, priorTable } of restoredTables) {
    try {
      const manifest = generateTailorDBTypeManifestFromSnapshot(priorTable, {
        subscribed: executorUsedTables.has(priorTable.name),
        namespaceGqlOperations: input?.config.gqlOperations,
      });
      await client.updateTailorDBType({
        workspaceId,
        namespaceName: migration.namespace,
        tailordbType: manifest,
      });
    } catch (rollbackError) {
      logger.warn(
        `Failed to roll back table '${tableName}' in namespace '${migration.namespace}': ` +
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
      logger.warn(
        `Failed to roll back table '${tableName}' in namespace '${migration.namespace}': ` +
          `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }
  }
}
