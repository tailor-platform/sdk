import { Code, ConnectError } from "@connectrpc/connect";
import { assert, vi } from "vitest";
import { captureMigrationFileState } from "#/cli/commands/tailordb/migrate/file-state";
import { formatMigrationNumber } from "#/cli/commands/tailordb/migrate/migration-number";
import { createMockMigrationDiff } from "#/cli/commands/tailordb/migrate/test-helpers/migration-diff";
import {
  sanitizeMigrationLabel,
  type PendingMigration,
} from "#/cli/commands/tailordb/migrate/types";
import {
  mockOperatorClient,
  type OperatorClientMock,
  type OperatorClientMocks,
  withOperatorClientMocks,
} from "#/cli/shared/test-helpers/operator-client";
import { tailorDBPlanResultContext } from "../../test-helpers/plan-results";
import { detectPendingMigrations, type updateMigrationLabel } from "../migration";
import type { NamespaceWithMigrations } from "#/cli/commands/tailordb/migrate/config";
import type { DiffChange, MigrationDiff } from "#/cli/commands/tailordb/migrate/diff-calculator";
import type { RemoteMigrationState } from "#/cli/commands/tailordb/migrate/remote-state";
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
import type {
  TailorDBType_FieldConfigSchema,
  TailorDBTypeSchema,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";

const WORKSPACE_ID = "test-workspace";
const NAMESPACE = "test-ns";
const MIGRATIONS_DIR = "/test/migrations";
const APP_NAME = "test-app";

function namespaceTrn(namespace: string) {
  return `trn:v1:workspace:${WORKSPACE_ID}:tailordb:${namespace}`;
}

type RemoteTableWrite =
  | "createTailorDBType"
  | "updateTailorDBType"
  | "deleteTailorDBType"
  | "createTailorDBGQLPermission"
  | "updateTailorDBGQLPermission"
  | "deleteTailorDBGQLPermission";

/**
 * Make a mocked client reject the table and GraphQL permission writes the Platform rejects:
 * creating one the client created fails with `AlreadyExists`; updating or deleting one the client
 * deleted, and any write to the permission of a table the client deleted, fails with `NotFound`.
 * A table the client creates starts without a permission, and deleting a table also deletes its
 * permission. A write counts from the moment it is sent until it is rejected, so two concurrent
 * writes conflict as they would on the Platform. A name the client has not written is accepted,
 * whether or not `listTailorDBTypes` lists it. The client's current implementations are wrapped,
 * so a method replaced afterwards keeps this only if the replacement calls the implementation
 * `getMockImplementation()` returned before it.
 * @param client - Client whose table and permission writes to wrap
 * @returns The same client
 */
export function trackRemoteTables<C extends OperatorClientMock<RemoteTableWrite>>(client: C): C {
  const tables = new Map<string, boolean>();
  const permissions = new Map<string, boolean>();
  const keyOf = (namespaceName: string | undefined, tableName: string | undefined) =>
    `${namespaceName}/${tableName}`;
  const tableMissing = (key: string) => tables.get(key) === false;
  const permissionMissing = (key: string) => tableMissing(key) || permissions.get(key) === false;
  const refuseIf = (refused: boolean, code: Code, message: string) => {
    if (refused) throw new ConnectError(message, code);
  };
  const setOrDelete = (map: Map<string, boolean>, key: string, value: boolean | undefined) => {
    if (value === undefined) map.delete(key);
    else map.set(key, value);
  };
  const recordWrite = async <T>(
    key: string,
    next: { table?: boolean | undefined; permission?: boolean | undefined },
    write: () => T,
  ): Promise<Awaited<T>> => {
    const before = { table: tables.get(key), permission: permissions.get(key) };
    if (next.table !== undefined) tables.set(key, next.table);
    if (next.permission !== undefined) permissions.set(key, next.permission);
    try {
      return await write();
    } catch (error) {
      setOrDelete(tables, key, before.table);
      setOrDelete(permissions, key, before.permission);
      throw error;
    }
  };

  const createType = client.createTailorDBType.getMockImplementation();
  const updateType = client.updateTailorDBType.getMockImplementation();
  const deleteType = client.deleteTailorDBType.getMockImplementation();
  const createPermission = client.createTailorDBGQLPermission.getMockImplementation();
  const updatePermission = client.updateTailorDBGQLPermission.getMockImplementation();
  const deletePermission = client.deleteTailorDBGQLPermission.getMockImplementation();
  assert(createType && updateType && deleteType);
  assert(createPermission && updatePermission && deletePermission);

  client.createTailorDBType.mockImplementation(async (request, options) => {
    const key = keyOf(request.namespaceName, request.tailordbType?.name);
    refuseIf(tables.get(key) === true, Code.AlreadyExists, `table ${key} already exists`);
    return recordWrite(key, { table: true, permission: false }, () => createType(request, options));
  });
  client.updateTailorDBType.mockImplementation(async (request, options) => {
    const key = keyOf(request.namespaceName, request.tailordbType?.name);
    refuseIf(tableMissing(key), Code.NotFound, `table ${key} not found`);
    return updateType(request, options);
  });
  client.deleteTailorDBType.mockImplementation(async (request, options) => {
    const key = keyOf(request.namespaceName, request.tailordbTypeName);
    refuseIf(tableMissing(key), Code.NotFound, `table ${key} not found`);
    return recordWrite(key, { table: false }, () => deleteType(request, options));
  });
  client.createTailorDBGQLPermission.mockImplementation(async (request, options) => {
    const key = keyOf(request.namespaceName, request.typeName);
    refuseIf(tableMissing(key), Code.NotFound, `table ${key} not found`);
    refuseIf(
      permissions.get(key) === true,
      Code.AlreadyExists,
      `permission of ${key} already exists`,
    );
    return recordWrite(key, { permission: true }, () => createPermission(request, options));
  });
  client.updateTailorDBGQLPermission.mockImplementation(async (request, options) => {
    const key = keyOf(request.namespaceName, request.typeName);
    refuseIf(permissionMissing(key), Code.NotFound, `permission of ${key} not found`);
    return updatePermission(request, options);
  });
  client.deleteTailorDBGQLPermission.mockImplementation(async (request, options) => {
    const key = keyOf(request.namespaceName, request.typeName);
    refuseIf(permissionMissing(key), Code.NotFound, `permission of ${key} not found`);
    return recordWrite(key, { permission: false }, () => deletePermission(request, options));
  });
  return client;
}

function untrackedMockClient() {
  return mockOperatorClient({
    createTailorDBService: {},
    getMetadata: { metadata: { labels: {} } },
    setMetadata: {},
    listTailorDBTypes: { tailordbTypes: [] },
    createTailorDBType: {},
    updateTailorDBType: {},
    createTailorDBGQLPermission: {},
    updateTailorDBGQLPermission: {},
    deleteTailorDBGQLPermission: {},
    deleteTailorDBType: {},
    deleteTailorDBService: {},
    getWorkflowByName: () => Promise.reject(new ConnectError("not found", Code.NotFound)),
    deleteWorkflowJobFunction: {},
    deleteFunctionRegistry: {},
  });
}

/**
 * Build an operator client whose TailorDB, metadata, and workflow cleanup methods succeed, except
 * for the table and permission writes {@link trackRemoteTables} rejects.
 * @param overrides - Methods to mock differently, or in addition; {@link trackRemoteTables} wraps them too
 * @returns The client, with each mocked method as a `vi.fn` spy
 */
export function createMockClient<K extends keyof OperatorClient = never>(
  overrides?: OperatorClientMocks<K>,
) {
  return trackRemoteTables(withOperatorClientMocks(untrackedMockClient(), overrides));
}

type MockedRemoteState = Pick<RemoteMigrationState, "number" | "historyId"> &
  Partial<RemoteMigrationState>;

export type PlannedPendingMigrations = TailorDBPlanResult["context"]["pendingMigrations"];

/**
 * Have the mocked detection find `migrations` pending and read each namespace's checkpoint the way
 * the real detection does, so the deploy expects that checkpoint.
 * @param migrations - Migrations to report as pending
 * @param remoteStateOf - Checkpoint, history ID, and any other remote state of a namespace when the detection runs
 * @returns The pending migrations a plan made at this point would record, for `context.pendingMigrations`
 */
export function mockPendingMigrations(
  migrations: PendingMigration[],
  remoteStateOf: (namespace: string) => MockedRemoteState,
): PlannedPendingMigrations {
  vi.mocked(detectPendingMigrations).mockImplementation(
    async (_client, _workspaceId, namespaces, _configPath, overrides, remoteStates) => {
      for (const { namespace } of namespaces) {
        if (overrides?.has(namespace)) continue;
        remoteStates?.set(namespace, {
          metadataExists: true,
          historyIdInvalid: false,
          inProgress: null,
          inProgressInvalid: false,
          maintenanceModeCheckpoint: null,
          cleanupCheckpoint: null,
          ...remoteStateOf(namespace),
        });
      }
      return migrations;
    },
  );
  return migrations.map(({ namespace, number }) => ({ namespace, number }));
}

export type RemoteCheckpoint = ReturnType<typeof createRemoteCheckpoint>;

export function createRemoteCheckpoint(initialNumber: number | null) {
  const state = {
    number: initialNumber,
    historyId: null as string | null,
    maintenanceMode: null as string | null,
    maintenanceModeChanges: [] as Array<string | null>,
    cleanup: null as string | null,
    cleanupChanges: [] as Array<string | null>,
  };
  const setCleanup = (cleanup: string | null) => {
    if (cleanup === state.cleanup) return;
    state.cleanup = cleanup;
    state.cleanupChanges.push(cleanup);
  };
  const record: typeof updateMigrationLabel = async (
    _client,
    _workspaceId,
    _namespace,
    number,
    historyId,
    recordMaintenanceMode,
    recordCleanup,
  ) => {
    state.number = number;
    state.historyId = historyId ?? null;
    if (recordMaintenanceMode) {
      state.maintenanceMode = sanitizeMigrationLabel(number);
      state.maintenanceModeChanges.push(state.maintenanceMode);
    }
    setCleanup(recordCleanup ? sanitizeMigrationLabel(number) : null);
    return true;
  };
  return {
    state,
    record,
    /**
     * Has the mocked detection find `migrations` pending on the checkpoint as it stands then.
     * @param migrations - Migrations to report as pending
     * @returns The pending migrations a plan made at this point would record, for `context.pendingMigrations`
     */
    mockPending: (migrations: PendingMigration[]): PlannedPendingMigrations =>
      mockPendingMigrations(migrations, () => ({
        number: state.number,
        historyId: state.historyId,
      })),
    createMockClient: <K extends keyof OperatorClient = never>(
      overrides?: OperatorClientMocks<K>,
    ) =>
      trackRemoteTables(
        withOperatorClientMocks(
          withOperatorClientMocks(untrackedMockClient(), {
            getMetadata: async () => ({
              metadata: {
                labels: {
                  ...(state.number !== null && {
                    "sdk-migration": sanitizeMigrationLabel(state.number),
                  }),
                  ...(state.historyId && { "sdk-migration-history": state.historyId }),
                  ...(state.maintenanceMode && { "sdk-maintenance-mode": state.maintenanceMode }),
                  ...(state.cleanup && { "sdk-migration-cleanup": state.cleanup }),
                },
              },
            }),
            setMetadata: async (request) => {
              const maintenanceMode = request.labels?.["sdk-maintenance-mode"] ?? null;
              if (
                request.trn === namespaceTrn(NAMESPACE) &&
                maintenanceMode !== state.maintenanceMode
              ) {
                state.maintenanceMode = maintenanceMode;
                state.maintenanceModeChanges.push(maintenanceMode);
              }
              if (request.trn === namespaceTrn(NAMESPACE)) {
                setCleanup(request.labels?.["sdk-migration-cleanup"] ?? null);
              }
              return {};
            },
          }),
          overrides,
        ),
      ),
  };
}

/**
 * List every table definition the client created or updated, in call order.
 * @param client - Mocked operator client
 * @returns Table name and written definition of each write
 */
export function tailordbTypeWrites(client: OperatorClient) {
  const writes: Array<{
    order: number;
    name: string;
    tailordbType: MessageInitShape<typeof TailorDBTypeSchema>;
  }> = [];
  for (const fn of [client.createTailorDBType, client.updateTailorDBType]) {
    const mock = vi.mocked(fn);
    mock.mock.calls.forEach((call, index) => {
      const tailordbType = call[0].tailordbType;
      const order = mock.mock.invocationCallOrder[index];
      if (tailordbType?.name === undefined || order === undefined) return;
      writes.push({ order, name: tailordbType.name, tailordbType });
    });
  }
  return writes.toSorted((a, b) => a.order - b.order);
}

/**
 * List the call order of each deletion of a table and of its GraphQL permission.
 * @param client - Mocked operator client
 * @param namespace - Namespace of the table
 * @param tableName - Table name
 * @returns Invocation order of each table deletion and each GraphQL permission deletion
 */
export function deleteOrders(client: OperatorClient, namespace: string, tableName: string) {
  const ordersOf = (
    mock: { calls: unknown[][]; invocationCallOrder: number[] },
    matches: (request: Record<string, unknown>) => boolean,
  ) =>
    mock.calls.flatMap((call, index) => {
      const order = mock.invocationCallOrder[index];
      return order !== undefined && matches(call[0] as Record<string, unknown>) ? [order] : [];
    });
  return {
    table: ordersOf(
      vi.mocked(client.deleteTailorDBType).mock,
      (request) => request.namespaceName === namespace && request.tailordbTypeName === tableName,
    ),
    permission: ordersOf(
      vi.mocked(client.deleteTailorDBGQLPermission).mock,
      (request) => request.namespaceName === namespace && request.typeName === tableName,
    ),
  };
}

/**
 * Summarize how a table and its GraphQL permission were deleted, to compare with
 * {@link DELETED_ONCE_AFTER_CHECKPOINT}.
 * @param client - Mocked operator client
 * @param namespace - Namespace of the table
 * @param tableName - Table name
 * @param checkpoint - Invocation order of the checkpoint update the deletion must follow
 * @returns Deletion counts and whether they ran in order
 */
export function deletionOf(
  client: OperatorClient,
  namespace: string,
  tableName: string,
  checkpoint: number | undefined,
) {
  const { table, permission } = deleteOrders(client, namespace, tableName);
  return {
    tableDeletes: table.length,
    permissionDeletes: permission.length,
    afterCheckpoint: checkpoint !== undefined && permission.every((order) => order > checkpoint),
    permissionFirst: table.every((tableOrder) => permission.every((order) => order < tableOrder)),
  };
}

export const DELETED_ONCE_AFTER_CHECKPOINT = {
  tableDeletes: 1,
  permissionDeletes: 1,
  afterCheckpoint: true,
  permissionFirst: true,
};

export const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

type ChangeEntries<Group extends TailorDBChangeSet[keyof TailorDBChangeSet]> = Partial<
  Pick<Group, "creates" | "updates" | "deletes" | "unchanged">
>;

interface PlanResultOptions {
  type?: ChangeEntries<TailorDBChangeSet["type"]> | undefined;
  gqlPermission?: ChangeEntries<TailorDBChangeSet["gqlPermission"]> | undefined;
  application?: Partial<Application> | undefined;
  context?: Partial<TailorDBPlanResult["context"]> | undefined;
  /** Local table definitions of the test namespace, as the plan reads them from the config. */
  local?: TailorDBSnapshotType[] | undefined;
}

function changeGroup(entries: ChangeEntries<TailorDBChangeSet[keyof TailorDBChangeSet]> = {}) {
  return {
    creates: entries.creates ?? [],
    updates: entries.updates ?? [],
    deletes: entries.deletes ?? [],
    unchanged: entries.unchanged ?? [],
  };
}

/**
 * Build a plan result for tests that mock the pending migrations. It skips the schema checks, so a
 * test that needs the remote schema verification before the apply belongs with the
 * "applyTailorDB migration label reconciliation" tests in `index.test.ts`, which read real
 * migration files.
 * @param options - Planned changes and context overrides
 * @returns Plan result for `applyTailorDB`
 */
export function createPlanResult(options: PlanResultOptions = {}): TailorDBPlanResult {
  const namespacesWithMigrations: NamespaceWithMigrations[] = options.context
    ?.namespacesWithMigrations ?? [{ namespace: NAMESPACE, migrationsDir: MIGRATIONS_DIR }];
  return {
    changeSet: {
      service: changeGroup(),
      type: changeGroup(options.type),
      gqlPermission: changeGroup(options.gqlPermission),
    },
    context: tailorDBPlanResultContext({
      workspaceId: WORKSPACE_ID,
      application: {
        name: APP_NAME,
        authServices: [{ config: { name: "auth", machineUsers: { migrator: {} } } }],
        ...options.application,
      } as Application,
      tailorDBInputs: options.local
        ? [
            {
              namespace: NAMESPACE,
              config: { files: [] },
              types: Object.fromEntries(options.local.map((type) => [type.name, type])),
            },
          ]
        : [],
      config: mockConfig,
      noSchemaCheck: true,
      namespacesWithMigrations,
      migrationFileState: captureMigrationFileState(namespacesWithMigrations),
      ...options.context,
    }),
  } as unknown as TailorDBPlanResult;
}

export function typeMetaRequest(tableName: string, namespace = NAMESPACE) {
  return {
    trn: `${namespaceTrn(namespace)}:type:${tableName}`,
    labels: { "sdk-name": APP_NAME },
  };
}

interface TypeEntryOptions {
  namespace?: string | undefined;
  fields?: Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>> | undefined;
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
  number?: number | undefined;
  hasScript?: boolean | undefined;
  namespace?: string | undefined;
  migrationsDir?: string | undefined;
  diff?: Partial<MigrationDiff> | undefined;
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
