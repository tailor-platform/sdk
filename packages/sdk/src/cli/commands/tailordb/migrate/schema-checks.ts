/**
 * Schema validation checks shared between `deploy` and
 * `tailordb migration validate`.
 *
 * These checks are read-only: they compare local table definitions, the
 * migration snapshot history, and the remote schema without mutating any
 * state.
 */

import * as fs from "node:fs";
import { resourceTrn } from "#/cli/commands/deploy/label";
import { fetchAllTolerant, type OperatorClient } from "#/cli/shared/client";
import { formatCommandHint } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import {
  hasChanges,
  formatMigrationDiff,
  formatDiffSummary,
  type MigrationDiff,
} from "./diff-calculator";
import {
  formatCheckpointSyncHint,
  formatNamespaceMigrationHint,
  migrationCommandArgs,
  type MigrationCommandContext,
} from "./hints";
import { collectNestedMemberChanges, getNestedMember } from "./nested-members";
import {
  buildPreMigrationSnapshot,
  getTablesDeletedAfterCheckpoint,
  includeTablesDeletedAfterCheckpoint,
} from "./pre-migration-schema";
import {
  describeMigrationCheckpoint,
  fetchRemoteMigrationState,
  isStaleMigrationInProgress,
  matchesLocalMigrationHistory,
  type RemoteMigrationState,
} from "./remote-state";
import {
  applyDiffToSnapshot,
  reconstructSnapshotFromMigrations,
  compareLocalTypesWithSnapshot,
  compareRemoteWithSnapshot,
  formatMigrationNumber,
  formatSchemaDrifts,
  createSnapshotType,
  createSnapshotFromRemoteTypes,
  getLatestMigrationNumber,
  getMigrationFilePath,
  getMigrationFiles,
  loadDiff,
  isMigrationRestricted,
  MIGRATION_RESTRICTION_SETTINGS,
  MISSING_REMOTE_SCRIPT_HASH_SUFFIX,
  stripFieldScriptProps,
  type RebaselineMarker,
  type RemoteGqlPermission,
  type SchemaSnapshot,
  type SnapshotFieldConfig,
  type SnapshotGqlOperations,
  type SnapshotSettings,
  type TailorDBSnapshotType,
  type NormalizedSchemaSnapshot,
} from "./snapshot";
import { createSnapshotRecord } from "./snapshot-normalization";
import {
  type MigrationCheckpointRepair,
  type MigrationInProgress,
  type RebaselinePendingInfo,
  type RemoteSchemaVerificationResult,
  type SchemaDrift,
} from "./types";
import type { TailorDBService } from "#/cli/services/tailordb/service";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { TailorDBServiceConfig } from "#/types/tailordb.generated";
import type { NamespaceWithMigrations } from "./config";
import type { TailorDBType as ProtoTailorDBType } from "@tailor-platform/tailor-proto/tailordb_resource_pb";

/**
 * Canonical input shape consumed by every TailorDB plan/proto step.
 * The deploy pipeline funnels `TailorDBService` through `createSnapshotType` so
 * that comparison, manifest generation and migration drift checks all read the
 * same snapshot-shaped data, keeping platform-side normalization (e.g. decimal
 * scale) in one place.
 */
export type TailorDBDeployInput = {
  namespace: string;
  config: TailorDBServiceConfig;
  types: Record<string, TailorDBSnapshotType>;
};

/**
 * Convert a runtime TailorDBService to the snapshot-shaped deploy input.
 * @param service - Loaded TailorDB service (after `loadTypes()`)
 * @returns The canonical snapshot-shaped deploy input for downstream plan/apply phases.
 */
export function toTailorDBDeployInput(service: TailorDBService): TailorDBDeployInput {
  const types: Record<string, TailorDBSnapshotType> = {};
  for (const [tableName, type] of Object.entries(service.types)) {
    types[tableName] = createSnapshotType(type);
  }
  return {
    namespace: service.namespace,
    config: service.config,
    types,
  };
}

// ============================================================================
// Remote Schema Verification
// ============================================================================

/**
 * Fetch all TailorDB tables from remote for a namespace
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {string} namespace - TailorDB namespace
 * @returns {Promise<ProtoTailorDBType[]>} Remote TailorDB tables
 */
async function fetchRemoteTypes(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
): Promise<ProtoTailorDBType[]> {
  return fetchAllTolerant(async (pageToken, maxPageSize) => {
    const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes({
      workspaceId,
      namespaceName: namespace,
      pageToken,
      pageSize: maxPageSize,
    });
    return [tailordbTypes, nextPageToken];
  });
}

async function fetchRemoteGqlPermissions(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
): Promise<RemoteGqlPermission[]> {
  return fetchAllTolerant(async (pageToken, maxPageSize) => {
    const { permissions, nextPageToken } = await client.listTailorDBGQLPermissions({
      workspaceId,
      namespaceName: namespace,
      pageToken,
      pageSize: maxPageSize,
    });
    return [permissions, nextPageToken];
  });
}

interface RemoteSchema {
  types: ProtoTailorDBType[];
  gqlPermissions: RemoteGqlPermission[];
}

async function fetchRemoteSchema(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
): Promise<RemoteSchema> {
  const [types, gqlPermissions] = await Promise.all([
    fetchRemoteTypes(client, workspaceId, namespace),
    fetchRemoteGqlPermissions(client, workspaceId, namespace),
  ]);
  return { types, gqlPermissions };
}

/**
 * Fetch a namespace's deployed schema as a normalized snapshot.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param namespace - TailorDB namespace
 * @returns The deployed schema snapshot
 */
export async function fetchRemoteSchemaSnapshot(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
): Promise<NormalizedSchemaSnapshot> {
  const { types, gqlPermissions } = await fetchRemoteSchema(client, workspaceId, namespace);
  return createSnapshotFromRemoteTypes(types, namespace, gqlPermissions);
}

type RemoteTailorDBSettings = NonNullable<NonNullable<ProtoTailorDBType["schema"]>["settings"]>;
type DeployGqlOperations = SnapshotGqlOperations | "query" | undefined;

function definedWhenNotEmpty<T extends object>(value: T): T | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

function namespaceConfig(
  config: LoadedConfig,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  namespace: string,
): TailorDBServiceConfig | undefined {
  const inputConfig = tailorDBInputs.find((input) => input.namespace === namespace)?.config;
  return inputConfig ?? (config.db?.[namespace] as TailorDBServiceConfig | undefined);
}

function namespaceGqlOperations(
  config: LoadedConfig,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  namespace: string,
): DeployGqlOperations {
  return namespaceConfig(config, tailorDBInputs, namespace)?.gqlOperations;
}

const GQL_OPERATION_KEYS = ["create", "update", "delete", "read"] as const;

function configuredDisabledGqlOperations(
  operations: DeployGqlOperations,
): SnapshotGqlOperations | undefined {
  if (!operations) return undefined;
  if (operations === "query") {
    return { create: false, update: false, delete: false };
  }

  const disabled: SnapshotGqlOperations = {};
  for (const key of GQL_OPERATION_KEYS) {
    if (operations[key] === false) disabled[key] = false;
  }

  return definedWhenNotEmpty(disabled);
}

function appliedConfiguredDisabledGqlOperations(
  remoteDisabled: RemoteTailorDBSettings["disableGqlOperations"] | undefined,
  configuredDisabled: SnapshotGqlOperations | undefined,
): SnapshotGqlOperations | undefined {
  if (!remoteDisabled || !configuredDisabled) return undefined;

  const disabled: SnapshotGqlOperations = {};
  for (const key of GQL_OPERATION_KEYS) {
    if (configuredDisabled[key] === false && remoteDisabled[key]) disabled[key] = false;
  }

  return definedWhenNotEmpty(disabled);
}

function deployComparableSnapshot(
  snapshot: SchemaSnapshot,
  remoteTypes: ReadonlyArray<ProtoTailorDBType>,
  gqlOperations: DeployGqlOperations,
): SchemaSnapshot {
  const remoteTablesByName = new Map(remoteTypes.map((type) => [type.name, type]));
  const configuredDisabled = configuredDisabledGqlOperations(gqlOperations);
  const tables: Record<string, TailorDBSnapshotType> = {};

  for (const [tableName, type] of Object.entries(snapshot.tables)) {
    const settings: SnapshotSettings = { ...type.settings };
    const remoteSettings = remoteTablesByName.get(tableName)?.schema?.settings;

    if (type.settings?.publishEvents === undefined && remoteSettings?.publishRecordEvents) {
      settings.publishEvents = true;
    }

    if (type.settings?.gqlOperations === undefined) {
      const disabled = appliedConfiguredDisabledGqlOperations(
        remoteSettings?.disableGqlOperations,
        configuredDisabled,
      );
      if (disabled) settings.gqlOperations = disabled;
    }

    const comparableType = { ...type };
    const comparableSettings = definedWhenNotEmpty(settings);
    if (comparableSettings) {
      comparableType.settings = comparableSettings;
    } else {
      delete comparableType.settings;
    }
    tables[tableName] = comparableType;
  }

  return { ...snapshot, tables };
}

/**
 * The Pre-phase schema a deploy leaves on the remote while a migration is in
 * progress, where the fields and nested members kept for the script carry no
 * scripts because the deploy adds them after building the table's scripts.
 * @param previousSnapshot - Schema before the migration
 * @param diff - The migration's diff
 * @returns Snapshot the remote schema must match
 */
export function buildInProgressSnapshot(
  previousSnapshot: SchemaSnapshot,
  diff: MigrationDiff,
): SchemaSnapshot {
  const snapshot = buildPreMigrationSnapshot(previousSnapshot, diff);
  for (const change of diff.changes) {
    const fields = snapshot.tables[change.tableName]?.fields;
    if (!fields) continue;
    if (change.kind === "field_removed") {
      stripKeptFieldScripts(fields, change.fieldName);
    } else if (change.kind === "field_renamed") {
      stripKeptFieldScripts(fields, change.previousFieldName);
    } else if (change.kind === "field_modified") {
      for (const member of collectNestedMemberChanges(change.before, change.after)) {
        if (member.kind !== "removed") continue;
        const parentMembers = getNestedMember(
          fields[change.fieldName],
          member.path.slice(0, -1),
        )?.fields;
        const memberName = member.path.at(-1);
        if (parentMembers && memberName !== undefined) {
          stripKeptFieldScripts(parentMembers, memberName);
        }
      }
    }
  }
  return snapshot;
}

function stripKeptFieldScripts(fields: Record<string, SnapshotFieldConfig>, name: string): void {
  const kept = Object.hasOwn(fields, name) ? fields[name] : undefined;
  if (kept) fields[name] = stripFieldScriptProps(kept);
}

function loadMigrationDiff(migrationsDir: string, migrationNumber: number): MigrationDiff | null {
  const diffPath = getMigrationFilePath(migrationsDir, migrationNumber, "diff");
  return fs.existsSync(diffPath) ? loadDiff(diffPath) : null;
}

function reconstructPreMigrationSnapshot(
  migrationsDir: string,
  migrationNumber: number,
): SchemaSnapshot | null {
  const previous = reconstructSnapshotFromMigrations(migrationsDir, migrationNumber - 1);
  const diff = loadMigrationDiff(migrationsDir, migrationNumber);
  if (!previous || !diff) return null;
  return buildInProgressSnapshot(previous, diff);
}

/**
 * The schema a namespace's remote must match. Each table may instead match `postPhase`, the schema
 * the Post-phase of a migration whose steps are in progress writes, because a deploy can stop
 * during or after that phase, before the checkpoint.
 */
interface ExpectedRemoteSchema {
  snapshot: SchemaSnapshot;
  postPhase?: SchemaSnapshot;
}

function reconstructExpectedRemoteSchema(
  migrationsDir: string,
  checkpoint: number,
  inProgress: MigrationInProgress | undefined,
): ExpectedRemoteSchema | null {
  if (!inProgress) {
    const snapshot = reconstructSnapshotFromMigrations(migrationsDir, checkpoint);
    return snapshot && { snapshot };
  }
  const previous = reconstructSnapshotFromMigrations(migrationsDir, inProgress.number - 1);
  const diff = loadMigrationDiff(migrationsDir, inProgress.number);
  if (!previous || !diff) return null;
  return {
    snapshot: buildInProgressSnapshot(previous, diff),
    ...(inProgress.kind === "steps" && {
      postPhase: includeTablesDeletedAfterCheckpoint(applyDiffToSnapshot(previous, diff), diff),
    }),
  };
}

/**
 * Compare a namespace's deployed schema with a snapshot the way a deploy would leave it
 * @param remote - Deployed tables and GraphQL permissions of the namespace
 * @param namespace - TailorDB namespace whose remote schema is compared
 * @param snapshot - Snapshot the remote is expected to match
 * @param config - Loaded application config
 * @param tailorDBInputs - Deploy inputs for namespace defaults
 * @param ignoredSettings - Table settings left out of the comparison on both sides
 * @param ignoredSettingsTables - Whether `ignoredSettings` applies to every table or only to tables in maintenance mode
 * @returns Drifts between the remote and the snapshot
 */
function compareRemoteSchemaWithSnapshot(
  remote: RemoteSchema,
  namespace: string,
  snapshot: SchemaSnapshot,
  config: LoadedConfig,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  ignoredSettings: readonly (keyof SnapshotSettings)[] = [],
  ignoredSettingsTables: "all" | "maintenance-mode" = "all",
): SchemaDrift[] {
  const expectedDeploySnapshot = deployComparableSnapshot(
    snapshot,
    remote.types,
    namespaceGqlOperations(config, tailorDBInputs, namespace),
  );
  return compareRemoteWithSnapshot(
    remote.types,
    expectedDeploySnapshot,
    remote.gqlPermissions,
    ignoredSettings,
    ignoredSettingsTables === "maintenance-mode"
      ? new Set(
          remote.types
            .filter((type) => isMigrationRestricted(type.schema?.settings))
            .map((type) => type.name),
        )
      : undefined,
  );
}

/** Where a namespace's remote migration checkpoint stands in its local migration history. */
export type RemoteCheckpointLocation =
  | { kind: "unset" }
  | {
      kind: "outside";
      number: number;
      /** Latest local migration, or `null` when the local history has none */
      localLatestMigration: number | null;
      /** Whether the namespace records another migration history ID, or one that cannot be read */
      historyIdMismatch: boolean;
      rebaselinePending?: RebaselinePendingInfo;
    }
  | {
      kind: "inside";
      number: number;
      checkpointRepair?: Omit<MigrationCheckpointRepair, "namespace">;
    };

/**
 * Locate a namespace's remote migration checkpoint in its local migration history.
 * @param remoteState - Remote migration state of the namespace
 * @param migrationsDir - Migrations directory of the namespace
 * @param rebaseline - Rebaseline marker of the local baseline, if any
 * @returns `unset` when no checkpoint was recorded, `outside` when the local history has no record of the checkpoint or its history ID, and `inside` otherwise, with the reset to `0000` a re-baselined history offers
 */
export function locateRemoteCheckpoint(
  remoteState: RemoteMigrationState,
  migrationsDir: string,
  rebaseline: RebaselineMarker | undefined,
): RemoteCheckpointLocation {
  const remoteMigrationNumber = remoteState.number;
  const latestMigrationNumber = getLatestMigrationNumber(migrationsDir);
  const localLatestMigration =
    getMigrationFiles(migrationsDir).length > 0 ? latestMigrationNumber : null;
  const historyIdMismatch = !matchesLocalMigrationHistory(
    remoteState,
    rebaseline?.historyId ?? null,
  );
  if (
    remoteState.historyIdInvalid ||
    (remoteMigrationNumber === null && remoteState.historyId !== null)
  ) {
    return {
      kind: "outside",
      number: remoteMigrationNumber ?? 0,
      localLatestMigration,
      historyIdMismatch,
    };
  }
  if (remoteMigrationNumber === null) return { kind: "unset" };

  const historyMatchesCurrent = rebaseline
    ? remoteState.historyId === rebaseline.historyId
    : remoteState.historyId === null;
  const historyMatchesReplaced = rebaseline
    ? remoteState.historyId === rebaseline.replacedHistoryId
    : false;
  const checkpointRepair =
    rebaseline &&
    historyMatchesReplaced &&
    remoteMigrationNumber === rebaseline.replacedLatestMigration
      ? ({
          from: remoteMigrationNumber,
          to: 0,
          fromHistoryId: remoteState.historyId,
          toHistoryId: rebaseline.historyId,
        } as const)
      : undefined;
  const checkpointMissingLocal =
    (!historyMatchesCurrent && !checkpointRepair) ||
    (remoteMigrationNumber > latestMigrationNumber && !checkpointRepair);
  if (checkpointMissingLocal) {
    const rebaselinePending =
      rebaseline &&
      historyMatchesReplaced &&
      remoteMigrationNumber < rebaseline.replacedLatestMigration
        ? { replacedLatestMigration: rebaseline.replacedLatestMigration }
        : undefined;
    return {
      kind: "outside",
      number: remoteMigrationNumber,
      localLatestMigration,
      historyIdMismatch,
      ...(rebaselinePending ? { rebaselinePending } : {}),
    };
  }
  return {
    kind: "inside",
    number: remoteMigrationNumber,
    ...(checkpointRepair ? { checkpointRepair } : {}),
  };
}

/**
 * List the remote tables a migration removed that are still to be deleted after its checkpoint,
 * leaving out a table a later local migration adds again.
 * @param migrationsDir - Migrations directory of the namespace
 * @param checkpoint - Migration whose checkpoint is committed
 * @param remoteTypes - Remote tables of the namespace
 * @returns Names of the tables, sorted
 */
function findUnfinishedRemovals(
  migrationsDir: string,
  checkpoint: number,
  remoteTypes: readonly ProtoTailorDBType[],
): string[] {
  const diffPath = getMigrationFilePath(migrationsDir, checkpoint, "diff");
  if (!fs.existsSync(diffPath)) return [];
  const deleted = getTablesDeletedAfterCheckpoint(loadDiff(diffPath));
  const latestTables = reconstructSnapshotFromMigrations(migrationsDir)?.tables ?? {};
  return remoteTypes
    .map((type) => type.name)
    .filter((tableName) => deleted.has(tableName) && !Object.hasOwn(latestTables, tableName))
    .toSorted();
}

type InterruptedMigrationCheck = {
  remote: RemoteSchema;
  namespace: string;
  migrationsDir: string;
  checkpoint: number;
  checkpointSnapshot: SchemaSnapshot;
  config: LoadedConfig;
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>;
};

function withGqlPermissionsOf(snapshot: SchemaSnapshot, source: SchemaSnapshot): SchemaSnapshot {
  const tables = createSnapshotRecord<TailorDBSnapshotType>();
  for (const [tableName, type] of Object.entries(snapshot.tables)) {
    const { permissions, ...rest } = type;
    const { gql: _, ...otherPermissions } = permissions ?? {};
    const gql = source.tables[tableName]?.permissions?.gql;
    const tablePermissions = gql ? { ...otherPermissions, gql } : otherPermissions;
    tables[tableName] =
      Object.keys(tablePermissions).length > 0 ? { ...rest, permissions: tablePermissions } : rest;
  }
  return { ...snapshot, tables };
}

/**
 * Find the migration whose Pre-phase an interrupted deploy left in place: every table must
 * match the checkpoint, or match the next migration's Pre-phase schema, with the GraphQL
 * permission of either, because the Pre-phase writes permissions after every table. With
 * maintenance mode on, a table in the Pre-phase shape must also be in maintenance mode, and the
 * settings maintenance mode overrides are not compared on tables in maintenance mode. A table
 * the checkpoint's migration deletes never counts as Pre-phase shaped, because a deploy whose
 * cleanup failed leaves it in place.
 * @param check - Remote schema and the checkpoint it is compared against
 * @returns The next migration's number, or `undefined` when a table matches neither schema
 */
function findInterruptedMigration(check: InterruptedMigrationCheck): number | undefined {
  const {
    remote,
    namespace,
    migrationsDir,
    checkpoint,
    checkpointSnapshot,
    config,
    tailorDBInputs,
  } = check;
  const nextMigration = checkpoint + 1;
  const prePhaseSnapshot = reconstructPreMigrationSnapshot(migrationsDir, nextMigration);
  if (!prePhaseSnapshot) return undefined;
  const maintenanceMode = config.maintenanceMode !== false;
  const compare = (snapshot: SchemaSnapshot) =>
    compareRemoteSchemaWithSnapshot(
      remote,
      namespace,
      snapshot,
      config,
      tailorDBInputs,
      maintenanceMode ? MIGRATION_RESTRICTION_SETTINGS : [],
      "maintenance-mode",
    );
  const restrictedTables = new Set(
    remote.types
      .filter((type) => isMigrationRestricted(type.schema?.settings))
      .map((type) => type.name),
  );
  const checkpointDiff = loadMigrationDiff(migrationsDir, checkpoint);
  const deletedByCheckpoint = checkpointDiff
    ? getTablesDeletedAfterCheckpoint(checkpointDiff)
    : new Set();
  const driftedTables = (snapshot: SchemaSnapshot) =>
    new Set(compare(snapshot).map((drift) => drift.tableName));
  const prePhaseMismatches = driftedTables(prePhaseSnapshot).intersection(
    driftedTables(withGqlPermissionsOf(prePhaseSnapshot, checkpointSnapshot)),
  );
  const accepted = compare(checkpointSnapshot).every(
    (drift) =>
      !prePhaseMismatches.has(drift.tableName) &&
      !deletedByCheckpoint.has(drift.tableName) &&
      (!maintenanceMode || restrictedTables.has(drift.tableName)),
  );
  return accepted ? nextMigration : undefined;
}

function notDeployedResult(namespace: string): RemoteSchemaVerificationResult {
  return {
    namespace,
    remoteMigrationNumber: 0,
    drifts: [],
    hasDrift: false,
    skipped: "not_deployed",
  };
}

export interface RemoteSchemaVerificationOptions {
  /**
   * Report the tables the checkpoint's migration removed in `unfinishedRemovals` instead of as
   * drift while the namespace records that their deletion did not finish, since a deploy deletes them.
   */
  acceptUnfinishedRemovals?: boolean;
  /**
   * Accept a namespace with no migration recorded as in progress whose tables each have the
   * checkpoint's shape or the Pre-phase shape of the next migration, and report that migration
   */
  acceptInterruptedMigration?: boolean;
}

/**
 * Verify remote schema matches the expected snapshot state. A namespace that has tables but no
 * migration checkpoint is verified as checkpoint 0, the way `deploy` applies migrations to it.
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {NamespaceWithMigrations[]} namespacesWithMigrations - Namespaces with migration config
 * @param {LoadedConfig} config - Loaded application config
 * @param {ReadonlyArray<TailorDBDeployInput>} tailorDBInputs - Deploy inputs for namespace defaults
 * @param {RemoteSchemaVerificationOptions} options - Verification options
 * @returns {Promise<RemoteSchemaVerificationResult[]>} Verification results per namespace
 */
export async function verifyRemoteSchema(
  client: OperatorClient,
  workspaceId: string,
  namespacesWithMigrations: NamespaceWithMigrations[],
  config: LoadedConfig,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
  options: RemoteSchemaVerificationOptions = {},
): Promise<RemoteSchemaVerificationResult[]> {
  const results: RemoteSchemaVerificationResult[] = [];

  for (const { namespace, migrationsDir } of namespacesWithMigrations) {
    // Get current remote migration number
    const remoteState = await fetchRemoteMigrationState(
      client,
      resourceTrn(workspaceId, "tailordb", namespace),
    );
    const location = locateRemoteCheckpoint(
      remoteState,
      migrationsDir,
      reconstructSnapshotFromMigrations(migrationsDir, 0)?.rebaseline,
    );

    if (location.kind === "outside") {
      results.push({
        namespace,
        remoteMigrationNumber: location.number,
        drifts: [],
        hasDrift: false,
        checkpointMissingLocal: true,
        localLatestMigration: location.localLatestMigration,
        historyIdMismatch: location.historyIdMismatch,
        ...(location.rebaselinePending ? { rebaselinePending: location.rebaselinePending } : {}),
      });
      continue;
    }

    const checkpointUnset = location.kind === "unset";
    if (checkpointUnset && !remoteState.metadataExists) {
      results.push(notDeployedResult(namespace));
      continue;
    }

    const remoteMigrationNumber = location.kind === "inside" ? location.number : 0;
    const checkpointRepair = location.kind === "inside" ? location.checkpointRepair : undefined;
    const expectedMigrationNumber = checkpointRepair?.to ?? remoteMigrationNumber;
    const inProgress =
      !checkpointRepair && remoteState.inProgress?.number === remoteMigrationNumber + 1
        ? remoteState.inProgress
        : undefined;

    const expected = reconstructExpectedRemoteSchema(
      migrationsDir,
      expectedMigrationNumber,
      inProgress,
    );
    if (!expected) {
      // No snapshots exist - skip verification
      results.push({
        namespace,
        remoteMigrationNumber,
        drifts: [],
        hasDrift: false,
        skipped: "no_snapshot",
      });
      continue;
    }

    const remote = await fetchRemoteSchema(client, workspaceId, namespace);
    if (checkpointUnset && remote.types.length === 0) {
      results.push(notDeployedResult(namespace));
      continue;
    }

    const unfinishedRemovals =
      options.acceptUnfinishedRemovals &&
      !checkpointRepair &&
      remoteState.cleanupCheckpoint === remoteMigrationNumber
        ? findUnfinishedRemovals(migrationsDir, remoteMigrationNumber, remote.types)
        : undefined;
    const leftInMaintenanceMode =
      inProgress === undefined && remoteState.maintenanceModeCheckpoint === remoteMigrationNumber;
    const verifiedRemote = unfinishedRemovals?.length
      ? { ...remote, types: remote.types.filter((type) => !unfinishedRemovals.includes(type.name)) }
      : remote;
    const compareWith = (snapshot: SchemaSnapshot) =>
      compareRemoteSchemaWithSnapshot(
        verifiedRemote,
        namespace,
        snapshot,
        config,
        tailorDBInputs,
        inProgress !== undefined || leftInMaintenanceMode ? MIGRATION_RESTRICTION_SETTINGS : [],
        leftInMaintenanceMode ? "maintenance-mode" : "all",
      );
    let drifts = compareWith(expected.snapshot);
    if (drifts.length > 0 && expected.postPhase) {
      const postPhaseDriftTables = new Set(
        compareWith(expected.postPhase).map((drift) => drift.tableName),
      );
      drifts = drifts.filter((drift) => postPhaseDriftTables.has(drift.tableName));
    }
    const noMigrationInProgress =
      !remoteState.inProgressInvalid &&
      (remoteState.inProgress === null || isStaleMigrationInProgress(remoteState));
    const interruptedMigration =
      drifts.length > 0 &&
      options.acceptInterruptedMigration &&
      noMigrationInProgress &&
      !checkpointRepair
        ? findInterruptedMigration({
            remote: verifiedRemote,
            namespace,
            migrationsDir,
            checkpoint: remoteMigrationNumber,
            checkpointSnapshot: expected.snapshot,
            config,
            tailorDBInputs,
          })
        : undefined;

    results.push({
      namespace,
      remoteMigrationNumber,
      ...(interruptedMigration === undefined
        ? { drifts, hasDrift: drifts.length > 0 }
        : { drifts: [], hasDrift: false, interruptedMigration }),
      ...(leftInMaintenanceMode ? { leftInMaintenanceMode } : {}),
      ...(checkpointUnset ? { checkpointUnset } : {}),
      ...(checkpointRepair && drifts.length === 0 ? { checkpointRepair } : {}),
      ...(remoteState.inProgress ? { migrationInProgress: remoteState.inProgress } : {}),
      ...(remoteState.inProgressInvalid ? { migrationInProgressInvalid: true } : {}),
      ...(unfinishedRemovals ? { unfinishedRemovals } : {}),
    });
  }

  return results;
}

/**
 * Minimal per-namespace drift shape needed to detect the v1-origin
 * missing-script-hash pattern and namespaces without a checkpoint, shared by
 * callers that hold either a full {@link RemoteSchemaVerificationResult} or a
 * validation report's subset of it.
 */
interface DriftGuidanceInput {
  hasDrift: boolean;
  drifts: readonly SchemaDrift[];
  checkpointUnset?: true;
}

function isMissingRemoteScriptHashDrift(drift: SchemaDrift): boolean {
  return (
    drift.kind === "script_mismatch" && drift.details.endsWith(MISSING_REMOTE_SCRIPT_HASH_SUFFIX)
  );
}

/**
 * Detect the pattern left by a v1-deployed environment: the v1 CLI never wrote
 * script hashes, so every drift reports a missing hash rather than an actual
 * schema difference.
 * @param {readonly DriftGuidanceInput[]} driftResults - Per-namespace verification results
 * @returns {boolean} True when every reported drift is a missing-script-hash drift
 */
function isLikelyPreV2ScriptHashDrift(driftResults: readonly DriftGuidanceInput[]): boolean {
  const withDrift = driftResults.filter((result) => result.hasDrift);
  return (
    withDrift.length > 0 &&
    withDrift.every(
      (result) => result.drifts.length > 0 && result.drifts.every(isMissingRemoteScriptHashDrift),
    )
  );
}

/**
 * Log common causes of remote schema drift and how to resolve them, unless only namespaces
 * without a checkpoint drifted, whose recovery {@link unsetCheckpointDriftHints} describes
 * @param {MigrationCommandContext} context - Config and workspace selection to preserve in the suggested command
 * @param {readonly DriftGuidanceInput[]} [driftResults] - Per-namespace verification results, used to add a targeted hint for the v1-origin missing-hash pattern
 * @returns {void}
 */
export function logRemoteDriftGuidance(
  context: MigrationCommandContext,
  driftResults?: readonly DriftGuidanceInput[],
): void {
  const drifted = driftResults?.filter((result) => result.hasDrift) ?? [];
  if (drifted.length > 0 && drifted.every((result) => result.checkpointUnset)) return;
  const statusCommand = formatCommandHint({
    command: "tailor",
    args: migrationCommandArgs(["status"], context),
  });
  logger.info("This may indicate:");
  logger.info("  - Another developer applied different migrations", { mode: "plain" });
  logger.info("  - Manual schema changes were made directly", { mode: "plain" });
  logger.info("  - Migration history is out of sync", { mode: "plain" });
  logger.newline();
  logger.info("To resolve:");
  logger.info(`  - Run ${statusCommand} to compare local vs remote.`, { mode: "plain" });
  logger.info("  - If remote is correct, update local tables and run 'migration generate'.", {
    mode: "plain",
  });
  logger.info(
    "  - If local migration history is correct, run 'migration sync <N>' to overwrite remote.",
    { mode: "plain" },
  );
  logger.info(
    "  - If remote already matches another migration, run 'migration sync <N>' with that migration to move only the checkpoint.",
    { mode: "plain" },
  );
  if (driftResults && isLikelyPreV2ScriptHashDrift(driftResults)) {
    logger.newline();
    logger.info(
      `Every listed drift is '${MISSING_REMOTE_SCRIPT_HASH_SUFFIX}'. Run 'migration sync <N>' above to add the missing hashes.`,
    );
  }
}

/**
 * Minimal per-namespace shape needed to explain a drift in a namespace without a migration
 * checkpoint, shared by callers that hold either a full {@link RemoteSchemaVerificationResult} or a
 * validation report's subset of it.
 */
interface UnsetCheckpointDriftInput {
  namespace: string;
  hasDrift: boolean;
  checkpointUnset?: true;
}

/**
 * Format how to recover each namespace whose tables differ from 0000 while it has no migration checkpoint.
 * @param results - Per-namespace verification results
 * @param context - Config and workspace selection to preserve in recovery commands
 * @returns Recovery instructions for human and JSON errors
 */
export function unsetCheckpointDriftHints(
  results: readonly UnsetCheckpointDriftInput[],
  context: MigrationCommandContext,
): string[] {
  return results
    .filter((result) => result.checkpointUnset && result.hasDrift)
    .map(({ namespace }) => {
      const syncCommand = formatNamespaceMigrationHint({
        ...context,
        subcommand: ["sync", formatMigrationNumber(0)],
        namespace,
      });
      const generateCommand = formatNamespaceMigrationHint({
        subcommand: ["generate", "--init"],
        namespace,
        configPath: context.configPath,
      });
      return `Namespace "${namespace}" has no migration checkpoint yet, so its tables must match migration 0000. Run ${syncCommand} to rewrite them to 0000, which deletes the tables and fields that 0000 does not have together with their data. To keep the tables instead, update the local tables to match them and recreate 0000 with ${generateCommand}, which deletes every migration of the namespace, so only while no workspace has been deployed with them.`;
    });
}

/**
 * Minimal per-namespace shape needed to report a missing remote checkpoint, shared by callers
 * that hold either a full {@link RemoteSchemaVerificationResult} or a validation report's subset.
 */
interface CheckpointMissingGuidanceInput {
  namespace: string;
  remoteMigrationNumber: number;
  rebaselinePending?: RebaselinePendingInfo;
}

type RebaselinePendingGuidanceInput = CheckpointMissingGuidanceInput & {
  rebaselinePending: RebaselinePendingInfo;
};

function hasRebaselinePending(
  result: CheckpointMissingGuidanceInput,
): result is RebaselinePendingGuidanceInput {
  return result.rebaselinePending !== undefined;
}

export interface CheckpointRecoveryInput extends CheckpointMissingGuidanceInput {
  /** Latest local migration, or `null` when the local history has none */
  localLatestMigration: number | null;
  /** Whether the namespace records another migration history ID, or one that cannot be read */
  historyIdMismatch: boolean;
}

/** First recovery step for a remote checkpoint outside the local migration history. */
export const PULL_LATEST_MIGRATIONS_SUGGESTION =
  "Pull the latest migration files if this checkout is behind.";

/**
 * Format recovery options for checkpoints outside the local history, excluding rebaseline recovery.
 * @param results - Namespaces with a missing checkpoint
 * @param context - Config and workspace selection to preserve in recovery commands
 * @returns Recovery instructions for human and JSON errors
 */
export function missingCheckpointRecoveryHints(
  results: readonly CheckpointRecoveryInput[],
  context: MigrationCommandContext,
): string[] {
  const missing = results.filter((result) => !result.rebaselinePending);
  if (missing.length === 0) return [];
  const syncCommands = missing.flatMap(({ namespace, localLatestMigration, historyIdMismatch }) =>
    localLatestMigration === null
      ? []
      : [
          `  ${formatCheckpointSyncHint({
            ...context,
            namespace,
            migrationNumber: localLatestMigration,
            replaceHistoryId: historyIdMismatch,
          })}`,
        ],
  );
  return [
    PULL_LATEST_MIGRATIONS_SUGGESTION,
    ...(missing.some((result) => result.historyIdMismatch && result.localLatestMigration !== null)
      ? [
          "For a namespace that records another migration history, work from a checkout of that history instead; run its --force command below only if the local migration history should replace it.",
        ]
      : []),
    ...(syncCommands.length > 0
      ? [
          "To move the checkpoint back to the local history on purpose, run the following, then deploy. Each command rewrites the tables to that migration, removing the fields it does not have and deleting the tables it does not have together with their data:",
          ...syncCommands,
        ]
      : []),
  ];
}

/**
 * Log recovery steps for namespaces that fell behind before `migration rebaseline` ran.
 * @param results - Namespaces with a missing checkpoint
 */
export function logRebaselinePendingGuidance(
  results: readonly CheckpointMissingGuidanceInput[],
): void {
  const pending = results.filter(hasRebaselinePending);
  if (pending.length > 0) {
    for (const result of pending) {
      const target = formatMigrationNumber(result.rebaselinePending.replacedLatestMigration);
      const current = formatMigrationNumber(result.remoteMigrationNumber);
      logger.info(
        `${result.namespace} fell behind before 'migration rebaseline' ran: every environment was required to already be at migration ${target} before the rebaseline, but this environment is at ${current}.`,
      );
    }
    logger.newline();
    logger.info("To recover:");
    logger.info(
      "  1. Restore the pre-rebaseline migrations/ directory from git history (the commit before 'migration rebaseline' ran; rebaseline preserves committed files there).",
      { mode: "plain" },
    );
    logger.info(
      "  2. Deploy this environment against that restored history until its checkpoint reaches the migration named above, running any migrate.ts scripts it still needs.",
      { mode: "plain" },
    );
    logger.info(
      "  3. Switch back to the current migration files and deploy again — the automatic checkpoint reset to the new baseline then applies.",
      { mode: "plain" },
    );
  }
}

/**
 * Format remote schema verification results for display
 * @param {RemoteSchemaVerificationResult[]} results - Verification results
 * @returns {string} Formatted results string
 */
export function formatRemoteVerificationResults(results: RemoteSchemaVerificationResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    if (!result.hasDrift) continue;

    lines.push(`Namespace: ${result.namespace}`);
    lines.push(
      `  Remote migration: ${describeMigrationCheckpoint(result.checkpointUnset ? null : result.remoteMigrationNumber)}`,
    );
    lines.push(`  Differences:`);
    lines.push(formatSchemaDrifts(result.drifts));
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Local Migration Diff Check
// ============================================================================

export interface MigrationCheckResult {
  namespace: string;
  migrationsDir: string;
  hasDiff: boolean;
  diff?: MigrationDiff;
}

/**
 * Check if there are schema differences between migration snapshots and local definitions
 * @param {ReadonlyMap<string, Record<string, TailorDBSnapshotType>>} typesByNamespace - Snapshot-shaped local tables by namespace
 * @param {NamespaceWithMigrations[]} namespacesWithMigrations - Namespaces with migrations config
 * @returns {Promise<MigrationCheckResult[]>} Results for each namespace
 */
export async function checkMigrationDiffs(
  typesByNamespace: ReadonlyMap<string, Record<string, TailorDBSnapshotType>>,
  namespacesWithMigrations: NamespaceWithMigrations[],
): Promise<MigrationCheckResult[]> {
  const results: MigrationCheckResult[] = [];

  for (const { namespace, migrationsDir } of namespacesWithMigrations) {
    const localTypes = typesByNamespace.get(namespace);
    if (!localTypes) {
      continue;
    }

    // Returns null when the migrations directory is missing or empty;
    // throws when existing migration files are invalid.
    const previousSnapshot = reconstructSnapshotFromMigrations(migrationsDir);

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

    // Compare with local tables
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
export function formatMigrationCheckResults(results: MigrationCheckResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    if (!result.hasDiff) {
      continue;
    }

    lines.push(`Namespace: ${result.namespace}`);

    if (!result.diff) {
      lines.push("  No migration snapshot found. Run 'tailor tailordb migration generate' first.");
    } else {
      lines.push(`  ${formatDiffSummary(result.diff)}`);
      lines.push("");
      lines.push(formatMigrationDiff(result.diff));
    }
    lines.push("");
  }

  return lines.join("\n");
}
