/**
 * Schema validation checks shared between `deploy` and
 * `tailordb migration validate`.
 *
 * These checks are read-only: they compare local type definitions, the
 * migration snapshot history, and the remote schema without mutating any
 * state.
 */

import { resourceTrn } from "#/cli/commands/deploy/label";
import { fetchAllTolerant, type OperatorClient } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import {
  hasChanges,
  formatMigrationDiff,
  formatDiffSummary,
  type MigrationDiff,
} from "./diff-calculator";
import { fetchRemoteMigrationState } from "./remote-state";
import {
  reconstructSnapshotFromMigrations,
  compareLocalTypesWithSnapshot,
  compareRemoteWithSnapshot,
  formatMigrationNumber,
  formatSchemaDrifts,
  createSnapshotType,
  createSnapshotFromRemoteTypes,
  getLatestMigrationNumber,
  type RemoteGqlPermission,
  type SchemaSnapshot,
  type SnapshotGqlOperations,
  type SnapshotSettings,
  type TailorDBSnapshotType,
  type NormalizedSchemaSnapshot,
} from "./snapshot";
import { type RemoteSchemaVerificationResult } from "./types";
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
  for (const [typeName, type] of Object.entries(service.types)) {
    types[typeName] = createSnapshotType(type);
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
  const [remoteTypes, remoteGqlPermissions] = await Promise.all([
    fetchRemoteTypes(client, workspaceId, namespace),
    fetchRemoteGqlPermissions(client, workspaceId, namespace),
  ]);
  return createSnapshotFromRemoteTypes(remoteTypes, namespace, remoteGqlPermissions);
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
  const remoteTypesByName = new Map(remoteTypes.map((type) => [type.name, type]));
  const configuredDisabled = configuredDisabledGqlOperations(gqlOperations);
  const tables: Record<string, TailorDBSnapshotType> = {};

  for (const [typeName, type] of Object.entries(snapshot.tables)) {
    const settings: SnapshotSettings = { ...type.settings };
    const remoteSettings = remoteTypesByName.get(typeName)?.schema?.settings;

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
    tables[typeName] = comparableType;
  }

  return { ...snapshot, tables };
}

/**
 * Verify remote schema matches the expected snapshot state
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {NamespaceWithMigrations[]} namespacesWithMigrations - Namespaces with migration config
 * @param {LoadedConfig} config - Loaded application config
 * @param {ReadonlyArray<TailorDBDeployInput>} tailorDBInputs - Deploy inputs for namespace defaults
 * @returns {Promise<RemoteSchemaVerificationResult[]>} Verification results per namespace
 */
export async function verifyRemoteSchema(
  client: OperatorClient,
  workspaceId: string,
  namespacesWithMigrations: NamespaceWithMigrations[],
  config: LoadedConfig,
  tailorDBInputs: ReadonlyArray<TailorDBDeployInput>,
): Promise<RemoteSchemaVerificationResult[]> {
  const results: RemoteSchemaVerificationResult[] = [];

  for (const { namespace, migrationsDir } of namespacesWithMigrations) {
    // Get current remote migration number
    const remoteState = await fetchRemoteMigrationState(
      client,
      resourceTrn(workspaceId, "tailordb", namespace),
    );
    const { metadataExists, number: remoteMigrationNumber } = remoteState;

    if (
      remoteState.historyIdInvalid ||
      (remoteMigrationNumber === null && remoteState.historyId !== null)
    ) {
      results.push({
        namespace,
        remoteMigrationNumber: remoteMigrationNumber ?? 0,
        drifts: [],
        hasDrift: false,
        checkpointMissingLocal: true,
      });
      continue;
    }

    // If no migration label exists, this is likely a first apply - skip verification
    // Remote verification only makes sense when there's an established migration history
    if (remoteMigrationNumber === null) {
      results.push({
        namespace,
        remoteMigrationNumber: 0,
        drifts: [],
        hasDrift: false,
        skipped: metadataExists ? "no_migration_label" : "not_deployed",
      });
      continue;
    }

    const latestMigrationNumber = getLatestMigrationNumber(migrationsDir);
    const baselineSnapshot = reconstructSnapshotFromMigrations(migrationsDir, 0);
    const rebaseline = baselineSnapshot?.rebaseline;
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
      results.push({
        namespace,
        remoteMigrationNumber,
        drifts: [],
        hasDrift: false,
        checkpointMissingLocal: true,
      });
      continue;
    }
    const expectedMigrationNumber = checkpointRepair?.to ?? remoteMigrationNumber;

    // Reconstruct the snapshot that the remote schema must match.
    const expectedSnapshot = reconstructSnapshotFromMigrations(
      migrationsDir,
      expectedMigrationNumber,
    );
    if (!expectedSnapshot) {
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

    // Fetch remote types
    const [remoteTypes, remoteGqlPermissions] = await Promise.all([
      fetchRemoteTypes(client, workspaceId, namespace),
      fetchRemoteGqlPermissions(client, workspaceId, namespace),
    ]);
    const expectedDeploySnapshot = deployComparableSnapshot(
      expectedSnapshot,
      remoteTypes,
      namespaceGqlOperations(config, tailorDBInputs, namespace),
    );

    // Compare remote with expected snapshot
    const drifts = compareRemoteWithSnapshot(
      remoteTypes,
      expectedDeploySnapshot,
      remoteGqlPermissions,
    );

    results.push({
      namespace,
      remoteMigrationNumber,
      drifts,
      hasDrift: drifts.length > 0,
      ...(checkpointRepair && drifts.length === 0 ? { checkpointRepair } : {}),
    });
  }

  return results;
}

/**
 * Log common causes of remote schema drift and how to resolve them
 */
export function logRemoteDriftGuidance(): void {
  logger.info("This may indicate:");
  logger.info("  - Another developer applied different migrations", { mode: "plain" });
  logger.info("  - Manual schema changes were made directly", { mode: "plain" });
  logger.info("  - Migration history is out of sync", { mode: "plain" });
  logger.newline();
  logger.info("To resolve:");
  logger.info("  - Run 'tailor tailordb migration status' to compare local vs remote.", {
    mode: "plain",
  });
  logger.info("  - If remote is correct, update local types and run 'migration generate'.", {
    mode: "plain",
  });
  logger.info(
    "  - If local migration history is correct, run 'migration sync <N>' to overwrite remote.",
    { mode: "plain" },
  );
  logger.info("  - If only bookkeeping is stale, run 'migration set <N>'.", { mode: "plain" });
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
    lines.push(`  Remote migration: ${formatMigrationNumber(result.remoteMigrationNumber)}`);
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
 * @param {ReadonlyMap<string, Record<string, TailorDBSnapshotType>>} typesByNamespace - Snapshot-shaped local types by namespace
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
