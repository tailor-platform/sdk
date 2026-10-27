import { assert, vi } from "vitest";
import { captureMigrationFileState } from "#/cli/commands/tailordb/migrate/file-state";
import { formatMigrationNumber } from "#/cli/commands/tailordb/migrate/migration-number";
import { createMockMigrationDiff } from "#/cli/commands/tailordb/migrate/test-helpers/migration-diff";
import {
  sanitizeMigrationLabel,
  type PendingMigration,
} from "#/cli/commands/tailordb/migrate/types";
import { detectPendingMigrations, type updateMigrationLabel } from "../migration";
import type { NamespaceWithMigrations } from "#/cli/commands/tailordb/migrate/config";
import type { DiffChange, MigrationDiff } from "#/cli/commands/tailordb/migrate/diff-calculator";
import type {
  NormalizedSchemaSnapshot,
  SnapshotFieldConfig,
  SnapshotSettings,
  TailorDBSnapshotType,
} from "#/cli/commands/tailordb/migrate/snapshot";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { TailorDBChangeSet, TailorDBPlanResult } from "../plan";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { TailorDBType_FieldConfigSchema } from "@tailor-platform/tailor-proto/tailordb_resource_pb";

const WORKSPACE_ID = "test-workspace";
const NAMESPACE = "test-ns";
const MIGRATIONS_DIR = "/test/migrations";
const APP_NAME = "test-app";

function namespaceTrn(namespace: string) {
  return `trn:v1:workspace:${WORKSPACE_ID}:tailordb:${namespace}`;
}

type MockClientOverrides = Partial<Record<keyof OperatorClient, unknown>>;

export function createMockClient(overrides: MockClientOverrides = {}): OperatorClient {
  return {
    createTailorDBService: vi.fn().mockResolvedValue({}),
    getMetadata: vi.fn().mockResolvedValue({ metadata: { labels: {} } }),
    setMetadata: vi.fn().mockResolvedValue({}),
    listTailorDBTypes: vi.fn().mockResolvedValue({ tailordbTypes: [] }),
    createTailorDBType: vi.fn().mockResolvedValue({}),
    updateTailorDBType: vi.fn().mockResolvedValue({}),
    createTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
    updateTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
    deleteTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
    deleteTailorDBType: vi.fn().mockResolvedValue({}),
    deleteTailorDBService: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as OperatorClient;
}

/**
 * Have the mocked detection find `migrations` pending and read each namespace's checkpoint the way
 * the real detection does, so the deploy expects that checkpoint.
 * @param migrations - Migrations to report as pending
 * @param checkpointOf - Checkpoint and history ID of a namespace when the detection runs
 */
export function mockPendingMigrations(
  migrations: PendingMigration[],
  checkpointOf: (namespace: string) => { number: number | null; historyId: string | null },
): void {
  vi.mocked(detectPendingMigrations).mockImplementation(
    async (_client, _workspaceId, namespaces, _configPath, overrides, remoteStates) => {
      for (const { namespace } of namespaces) {
        if (overrides?.has(namespace)) continue;
        remoteStates?.set(namespace, {
          metadataExists: true,
          ...checkpointOf(namespace),
          historyIdInvalid: false,
          inProgress: null,
          inProgressInvalid: false,
          maintenanceModeCheckpoint: null,
        });
      }
      return migrations;
    },
  );
}

export type RemoteCheckpoint = ReturnType<typeof createRemoteCheckpoint>;

export function createRemoteCheckpoint(initialNumber: number | null) {
  const state = {
    number: initialNumber,
    historyId: null as string | null,
    maintenanceMode: null as string | null,
    maintenanceModeChanges: [] as Array<string | null>,
  };
  const record: typeof updateMigrationLabel = async (
    _client,
    _workspaceId,
    _namespace,
    number,
    historyId,
    recordMaintenanceMode,
  ) => {
    state.number = number;
    state.historyId = historyId ?? null;
    if (recordMaintenanceMode) {
      state.maintenanceMode = sanitizeMigrationLabel(number);
      state.maintenanceModeChanges.push(state.maintenanceMode);
    }
    return true;
  };
  return {
    state,
    record,
    /**
     * Has the mocked detection find `migrations` pending on the checkpoint as it stands then.
     * @param migrations - Migrations to report as pending
     */
    mockPending: (migrations: PendingMigration[]): void => {
      mockPendingMigrations(migrations, () => ({
        number: state.number,
        historyId: state.historyId,
      }));
    },
    createMockClient: (overrides: MockClientOverrides = {}): OperatorClient =>
      createMockClient({
        getMetadata: vi.fn(async () => ({
          metadata: {
            labels: {
              ...(state.number !== null && {
                "sdk-migration": sanitizeMigrationLabel(state.number),
              }),
              ...(state.historyId && { "sdk-migration-history": state.historyId }),
              ...(state.maintenanceMode && { "sdk-maintenance-mode": state.maintenanceMode }),
            },
          },
        })),
        setMetadata: vi.fn(async (request: { trn: string; labels: Record<string, string> }) => {
          const maintenanceMode = request.labels["sdk-maintenance-mode"] ?? null;
          if (
            request.trn === namespaceTrn(NAMESPACE) &&
            maintenanceMode !== state.maintenanceMode
          ) {
            state.maintenanceMode = maintenanceMode;
            state.maintenanceModeChanges.push(maintenanceMode);
          }
          return {};
        }),
        ...overrides,
      }),
  };
}

export const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

type ChangeEntries<Group extends TailorDBChangeSet[keyof TailorDBChangeSet]> = Partial<
  Pick<Group, "creates" | "updates" | "deletes" | "unchanged">
>;

interface PlanResultOptions {
  type?: ChangeEntries<TailorDBChangeSet["type"]>;
  gqlPermission?: ChangeEntries<TailorDBChangeSet["gqlPermission"]>;
  application?: Partial<Application>;
  context?: Partial<TailorDBPlanResult["context"]>;
}

function changeGroup(entries: ChangeEntries<TailorDBChangeSet[keyof TailorDBChangeSet]> = {}) {
  return {
    creates: entries.creates ?? [],
    updates: entries.updates ?? [],
    deletes: entries.deletes ?? [],
    unchanged: entries.unchanged ?? [],
  };
}

export function createPlanResult(options: PlanResultOptions = {}): TailorDBPlanResult {
  const namespacesWithMigrations: NamespaceWithMigrations[] = options.context
    ?.namespacesWithMigrations ?? [{ namespace: NAMESPACE, migrationsDir: MIGRATIONS_DIR }];
  return {
    changeSet: {
      service: changeGroup(),
      type: changeGroup(options.type),
      gqlPermission: changeGroup(options.gqlPermission),
    },
    context: {
      workspaceId: WORKSPACE_ID,
      application: {
        name: APP_NAME,
        authService: { config: { name: "auth", machineUsers: { migrator: {} } } },
        ...options.application,
      },
      tailorDBInputs: [],
      executorUsedTables: new Set<string>(),
      config: mockConfig,
      noSchemaCheck: true,
      checkpointRepairs: [],
      namespacesWithMigrations,
      migrationFileState: captureMigrationFileState(namespacesWithMigrations),
      ...options.context,
    },
  } as unknown as TailorDBPlanResult;
}

export function typeMetaRequest(tableName: string, namespace = NAMESPACE) {
  return {
    trn: `${namespaceTrn(namespace)}:type:${tableName}`,
    labels: { "sdk-name": APP_NAME },
  };
}

interface TypeEntryOptions {
  namespace?: string;
  fields?: Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>>;
}

export function typeEntry(tableName: string, options: TypeEntryOptions = {}) {
  const namespace = options.namespace ?? NAMESPACE;
  return {
    name: tableName,
    request: {
      workspaceId: WORKSPACE_ID,
      namespaceName: namespace,
      tailordbType: {
        name: tableName,
        schema: { fields: options.fields ?? { name: { type: "string", required: true } } },
      },
    },
    metaRequest: typeMetaRequest(tableName, namespace),
  };
}

export function typeDeletion(tableName: string, namespace = NAMESPACE) {
  return {
    name: tableName,
    request: { workspaceId: WORKSPACE_ID, namespaceName: namespace, tailordbTypeName: tableName },
  };
}

export function gqlPermissionEntry(tableName: string, namespace = NAMESPACE) {
  return {
    name: tableName,
    request: {
      workspaceId: WORKSPACE_ID,
      namespaceName: namespace,
      typeName: tableName,
      permission: {},
    },
  };
}

export function gqlPermissionDeletion(tableName: string, namespace = NAMESPACE) {
  return {
    name: tableName,
    request: { workspaceId: WORKSPACE_ID, namespaceName: namespace, typeName: tableName },
  };
}

interface PendingMigrationOptions {
  number?: number;
  hasScript?: boolean;
  namespace?: string;
  migrationsDir?: string;
  diff?: Partial<MigrationDiff>;
}

export function mkPendingMigration(
  changes: DiffChange[],
  options: PendingMigrationOptions = {},
): PendingMigration {
  const number = options.number ?? 1;
  const hasScript = options.hasScript ?? true;
  const namespace = options.namespace ?? NAMESPACE;
  const migrationsDir = options.migrationsDir ?? MIGRATIONS_DIR;
  const label = formatMigrationNumber(number);
  return {
    number,
    scriptPath: `${migrationsDir}/${label}/migrate.ts`,
    diffPath: `${migrationsDir}/${label}/diff.json`,
    namespace,
    migrationsDir,
    hasScript,
    scriptForm: hasScript ? { kind: "main" } : null,
    diff: createMockMigrationDiff({
      namespace,
      changes,
      requiresMigrationScript: hasScript,
      ...options.diff,
    }),
  };
}

export function snapshotTable(
  name: string,
  fields: Record<string, SnapshotFieldConfig>,
  settings?: SnapshotSettings,
): TailorDBSnapshotType {
  return { name, pluralForm: `${name.toLowerCase()}s`, fields, ...(settings && { settings }) };
}

export type SnapshotTablesByVersion = Record<number, Record<string, TailorDBSnapshotType>>;

export function snapshotAt(
  tablesByVersion: SnapshotTablesByVersion,
  maxVersion?: number,
): NormalizedSchemaSnapshot {
  assert(Object.keys(tablesByVersion).length > 0, "empty snapshot fixture");
  const number = maxVersion ?? Math.max(...Object.keys(tablesByVersion).map(Number));
  const tables = tablesByVersion[number];
  assert(tables, `No snapshot fixture configured for migration number: ${number}`);
  return {
    version: 1,
    namespace: NAMESPACE,
    createdAt: "2026-01-01T00:00:00.000Z",
    tables,
  } as NormalizedSchemaSnapshot;
}
