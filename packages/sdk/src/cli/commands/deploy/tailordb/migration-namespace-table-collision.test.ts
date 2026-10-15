/**
 * Table names are only unique within a namespace: a table can move from one
 * namespace to another, leaving its old name in the first namespace's history.
 * Each migration's phases must read and write only the tables of its own
 * namespace.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { applyTailorDB, captureMigrationFileState } from "./index";
import type { DiffChange } from "#/cli/commands/tailordb/migrate/diff-calculator";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { Application } from "#/cli/services/application";
import type { TailorDBService } from "#/cli/services/tailordb/service";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";

const MAIN = "main-ns";
const SUB = "sub-ns";

const state = vi.hoisted(() => ({
  checkpoints: new Map<string, number>(),
  migratingNamespaces: [] as string[],
  tablesByDir: {} as Record<string, Record<number, unknown>>,
}));

vi.mock("./migration", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./migration");
  return {
    ...original,
    detectPendingMigrations: vi.fn(),
    executeMigrations: vi.fn().mockResolvedValue(undefined),
    updateMigrationLabel: vi.fn(),
  };
});

vi.mock("#/cli/commands/tailordb/migrate/config", () => ({
  getNamespacesWithMigrations: vi.fn(() =>
    state.migratingNamespaces.map((namespace) => ({
      namespace,
      migrationsDir: `/test/${namespace}/migrations`,
    })),
  ),
}));

vi.mock("#/cli/commands/tailordb/migrate/snapshot", async (importOriginal) => {
  const original =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    (await importOriginal()) as typeof import("#/cli/commands/tailordb/migrate/snapshot");
  return {
    ...original,
    assertValidMigrationFiles: vi.fn(),
    reconstructSnapshotFromMigrations: vi.fn((migrationsDir: string, maxVersion?: number) => {
      const tablesByVersion = state.tablesByDir[migrationsDir] ?? {};
      const number = maxVersion ?? Math.max(...Object.keys(tablesByVersion).map(Number));
      const tables = tablesByVersion[number];
      if (!tables) {
        throw new Error(`No snapshot fixture for ${migrationsDir} migration ${number}`);
      }
      return { version: 1, namespace: "", createdAt: "2026-01-01T00:00:00.000Z", tables };
    }),
  };
});

import * as migrationModule from "./migration";

const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

type Fields = Record<string, { type: string; required: boolean }>;
type TypeWrite = {
  namespaceName?: string;
  tailordbType?: { name?: string; schema?: { fields?: object } };
};
type TypeEntry = ReturnType<typeof typeEntry>;
type DeleteEntry = ReturnType<typeof deleteEntry>;

function migrationsDirOf(namespace: string) {
  return `/test/${namespace}/migrations`;
}

function snapshotTable(name: string, fields: Fields) {
  return { name, pluralForm: `${name.toLowerCase()}s`, fields };
}

function metaRequest(namespace: string, tableName: string) {
  return {
    trn: `trn:v1:workspace:test-workspace:tailordb:${namespace}:type:${tableName}`,
    labels: { "sdk-name": "test-app" },
  };
}

function typeEntry(namespace: string, tableName: string, fields: Fields) {
  return {
    name: tableName,
    request: {
      workspaceId: "test-workspace",
      namespaceName: namespace,
      tailordbType: { name: tableName, schema: { fields } },
    },
    metaRequest: metaRequest(namespace, tableName),
  };
}

function deleteEntry(namespace: string, tableName: string) {
  return {
    type: {
      name: tableName,
      request: {
        workspaceId: "test-workspace",
        namespaceName: namespace,
        tailordbTypeName: tableName,
      },
    },
    gqlPermission: {
      name: tableName,
      request: { workspaceId: "test-workspace", namespaceName: namespace, typeName: tableName },
    },
  };
}

function createMockPlanResult(options: {
  creates?: TypeEntry[];
  updates?: TypeEntry[];
  unchanged?: Omit<TypeEntry, "request">[];
  deletes?: DeleteEntry[];
}) {
  const service = (namespace: string) =>
    ({
      namespace,
      loadTypes: vi.fn().mockResolvedValue({}),
      types: {},
    }) as unknown as TailorDBService;
  const namespacesWithMigrations = state.migratingNamespaces.map((namespace) => ({
    namespace,
    migrationsDir: migrationsDirOf(namespace),
  }));
  const deletes = options.deletes ?? [];
  return {
    changeSet: {
      service: {
        creates: [],
        updates: [],
        deletes: [],
        title: "TailorDB Services",
        isEmpty: () => true,
        lines: () => [],
      },
      type: {
        creates: options.creates ?? [],
        updates: options.updates ?? [],
        deletes: deletes.map((entry) => entry.type),
        unchanged: options.unchanged ?? [],
        title: "TailorDB tables",
        isEmpty: () => false,
        lines: () => [],
      },
      gqlPermission: {
        creates: [],
        updates: [],
        deletes: deletes.map((entry) => entry.gqlPermission),
        title: "TailorDB GQL Permissions",
        isEmpty: () => false,
        lines: () => [],
      },
    },
    conflicts: [],
    unmanaged: [],
    resourceOwners: new Set<string>(),
    context: {
      workspaceId: "test-workspace",
      application: {
        name: "test-app",
        tailorDBServices: [service(MAIN), service(SUB)],
        authService: { config: { name: "test-auth", machineUsers: { admin: {} } } },
      } as unknown as Application,
      tailorDBInputs: [],
      executorUsedTables: new Set<string>(),
      config: mockConfig,
      noSchemaCheck: true,
      checkpointRepairs: [],
      namespacesWithMigrations,
      migrationFileState: captureMigrationFileState(namespacesWithMigrations),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function mkPendingMigration(
  namespace: string,
  number: number,
  changes: DiffChange[],
  hasScript = true,
): PendingMigration {
  const migrationsDir = migrationsDirOf(namespace);
  const label = String(number).padStart(4, "0");
  return {
    number,
    scriptPath: `${migrationsDir}/${label}/migrate.ts`,
    diffPath: `${migrationsDir}/${label}/diff.json`,
    namespace,
    migrationsDir,
    hasScript,
    scriptForm: hasScript ? { kind: "main" } : null,
    diff: {
      version: 1,
      namespace,
      createdAt: "2026-01-01T00:00:00.000Z",
      changes,
      hasBreakingChanges: false,
      breakingChanges: [],
      hasWarnings: false,
      warnings: [],
      requiresMigrationScript: hasScript,
    },
  };
}

function tableAdded(tableName: string): DiffChange {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { kind: "table_added", tableName } as any;
}

function tableRemoved(tableName: string): DiffChange {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { kind: "table_removed", tableName } as any;
}

function requiredFieldAdded(tableName: string, fieldName: string): DiffChange {
  return {
    kind: "field_added",
    tableName,
    fieldName,
    after: { type: "string", required: true },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function createMockClient() {
  return {
    createTailorDBService: vi.fn().mockResolvedValue({}),
    setMetadata: vi.fn().mockResolvedValue({}),
    getMetadata: vi.fn().mockImplementation(async ({ trn }: { trn: string }) => {
      const checkpoint = state.checkpoints.get(trn.split(":").at(-1) ?? "");
      return {
        metadata: {
          labels:
            checkpoint === undefined
              ? {}
              : { "sdk-migration": `m${String(checkpoint).padStart(4, "0")}` },
        },
      };
    }),
    listTailorDBTypes: vi.fn().mockResolvedValue({ tailordbTypes: [] }),
    createTailorDBType: vi.fn().mockResolvedValue({}),
    updateTailorDBType: vi.fn().mockResolvedValue({}),
    createTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
    updateTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
    deleteTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
    deleteTailorDBType: vi.fn().mockResolvedValue({}),
    deleteTailorDBService: vi.fn().mockResolvedValue({}),
  } as unknown as OperatorClient;
}

function typeWritesOf(mock: { calls: unknown[][] }, namespace: string, tableName: string) {
  return mock.calls
    .map((call) => call[0] as TypeWrite)
    .filter(
      (request) => request.namespaceName === namespace && request.tailordbType?.name === tableName,
    );
}

function typeWriteFields(client: OperatorClient, namespace: string, tableName: string) {
  return [
    ...typeWritesOf(vi.mocked(client.createTailorDBType).mock, namespace, tableName),
    ...typeWritesOf(vi.mocked(client.updateTailorDBType).mock, namespace, tableName),
  ].map((request) => Object.keys(request.tailordbType?.schema?.fields ?? {}));
}

function typeCreateCount(client: OperatorClient, namespace: string, tableName: string) {
  return typeWritesOf(vi.mocked(client.createTailorDBType).mock, namespace, tableName).length;
}

function deleteOrders(client: OperatorClient, namespace: string, tableName: string) {
  const ordersOf = (
    mock: { calls: unknown[][]; invocationCallOrder: number[] },
    matches: (request: Record<string, unknown>) => boolean,
  ) =>
    mock.calls.flatMap((call, index) =>
      matches(call[0] as Record<string, unknown>) ? [mock.invocationCallOrder[index]!] : [],
    );
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

function checkpointOrder(namespace: string, number: number) {
  const mocked = vi.mocked(migrationModule.updateMigrationLabel);
  const index = mocked.mock.calls.findIndex((call) => call[2] === namespace && call[3] === number);
  return index === -1 ? undefined : mocked.mock.invocationCallOrder[index];
}

function deletionOf(
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

const DELETED_ONCE_AFTER_CHECKPOINT = {
  tableDeletes: 1,
  permissionDeletes: 1,
  afterCheckpoint: true,
  permissionFirst: true,
};

function writtenMetadataTrns(client: OperatorClient) {
  return vi.mocked(client.setMetadata).mock.calls.map((call) => call[0].trn);
}

describe("migration flow: a table name shared across namespaces", () => {
  beforeEach(() => {
    state.checkpoints.clear();
    state.migratingNamespaces = [MAIN, SUB];
    state.tablesByDir = {};
    vi.mocked(migrationModule.executeMigrations).mockClear();
    vi.mocked(migrationModule.updateMigrationLabel).mockReset();
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(
      async (_client, _workspaceId, namespace, number) => {
        state.checkpoints.set(namespace, number);
        return true;
      },
    );
  });

  const mainItem = { mainName: { type: "string", required: true } };
  const mainItemWithCode = { ...mainItem, mainCode: { type: "string", required: true } };
  const subItem = { subName: { type: "string", required: true } };
  const moveOutOfMain = [
    mkPendingMigration(MAIN, 1, [requiredFieldAdded("Item", "mainCode")]),
    mkPendingMigration(MAIN, 2, [tableRemoved("Item")], false),
  ];
  const addToSub = mkPendingMigration(SUB, 1, [tableAdded("Item")]);

  test.each([
    {
      title: "its own migration creates it after the other namespace's migrations",
      migrating: [MAIN, SUB],
      pending: [...moveOutOfMain, addToSub],
      entry: "create",
    },
    {
      title: "its own migration creates it before the other namespace's migrations",
      migrating: [MAIN, SUB],
      pending: [addToSub, ...moveOutOfMain],
      entry: "create",
    },
    {
      title: "the new table is created without a migration",
      migrating: [MAIN],
      pending: moveOutOfMain,
      entry: "create",
    },
    {
      title: "the existing table is updated without a migration",
      migrating: [MAIN],
      pending: moveOutOfMain,
      entry: "update",
    },
  ])(
    "a table moved to another namespace is written from that namespace's schema when $title",
    async ({ migrating, pending, entry }) => {
      state.migratingNamespaces = migrating;
      state.tablesByDir = {
        [migrationsDirOf(MAIN)]: {
          0: { Item: snapshotTable("Item", mainItem) },
          1: { Item: snapshotTable("Item", mainItemWithCode) },
          2: {},
        },
        [migrationsDirOf(SUB)]: { 0: {}, 1: { Item: snapshotTable("Item", subItem) } },
      };
      for (const namespace of migrating) state.checkpoints.set(namespace, 0);
      vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue(pending);
      const client = createMockClient();
      const subEntry = typeEntry(SUB, "Item", subItem);

      await applyTailorDB(
        client,
        createMockPlanResult({
          ...(entry === "create" ? { creates: [subEntry] } : { updates: [subEntry] }),
          deletes: [deleteEntry(MAIN, "Item")],
        }),
        "create-update",
      );

      const subWrites = typeWriteFields(client, SUB, "Item");
      expect(subWrites.length).toBeGreaterThan(0);
      for (const fields of subWrites) expect(fields).toEqual(["subName"]);
      expect(typeCreateCount(client, SUB, "Item")).toBe(entry === "create" ? 1 : 0);
      expect(writtenMetadataTrns(client)).toContain(subEntry.metaRequest.trn);

      expect(deletionOf(client, MAIN, "Item", checkpointOrder(MAIN, 2))).toEqual(
        DELETED_ONCE_AFTER_CHECKPOINT,
      );
      expect(deleteOrders(client, SUB, "Item")).toEqual({ table: [], permission: [] });
    },
  );

  test("each namespace's migration deletes only its own table of a shared name", async () => {
    const legacy = { value: { type: "string", required: false } };
    state.tablesByDir = {
      [migrationsDirOf(MAIN)]: { 0: { Legacy: snapshotTable("Legacy", legacy) }, 1: {} },
      [migrationsDirOf(SUB)]: { 0: { Legacy: snapshotTable("Legacy", legacy) }, 1: {} },
    };
    state.checkpoints.set(MAIN, 0);
    state.checkpoints.set(SUB, 0);
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration(MAIN, 1, [tableRemoved("Legacy")]),
      mkPendingMigration(SUB, 1, [tableRemoved("Legacy")]),
    ]);
    const client = createMockClient();

    await applyTailorDB(
      client,
      createMockPlanResult({ deletes: [deleteEntry(MAIN, "Legacy"), deleteEntry(SUB, "Legacy")] }),
      "create-update",
    );

    expect(deletionOf(client, MAIN, "Legacy", checkpointOrder(MAIN, 1))).toEqual(
      DELETED_ONCE_AFTER_CHECKPOINT,
    );
    expect(deletionOf(client, SUB, "Legacy", checkpointOrder(SUB, 1))).toEqual(
      DELETED_ONCE_AFTER_CHECKPOINT,
    );
  });

  test("deletes a namespace's table after the migrations even when another namespace's migration removes the same name", async () => {
    state.migratingNamespaces = [MAIN];
    const legacy = { value: { type: "string", required: false } };
    state.tablesByDir = {
      [migrationsDirOf(MAIN)]: { 0: { Legacy: snapshotTable("Legacy", legacy) }, 1: {}, 2: {} },
    };
    state.checkpoints.set(MAIN, 0);
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration(MAIN, 1, [tableRemoved("Legacy")], false),
      mkPendingMigration(MAIN, 2, []),
    ]);
    const client = createMockClient();

    await applyTailorDB(
      client,
      createMockPlanResult({ deletes: [deleteEntry(MAIN, "Legacy"), deleteEntry(SUB, "Legacy")] }),
      "create-update",
    );

    expect(deletionOf(client, MAIN, "Legacy", checkpointOrder(MAIN, 1))).toEqual(
      DELETED_ONCE_AFTER_CHECKPOINT,
    );
    expect(deletionOf(client, SUB, "Legacy", checkpointOrder(MAIN, 2))).toEqual(
      DELETED_ONCE_AFTER_CHECKPOINT,
    );
  });

  test("writes the metadata of an unchanged table whose name another namespace's migration removes", async () => {
    state.migratingNamespaces = [MAIN];
    const legacy = { value: { type: "string", required: false } };
    state.tablesByDir = {
      [migrationsDirOf(MAIN)]: { 0: { Legacy: snapshotTable("Legacy", legacy) }, 1: {} },
    };
    state.checkpoints.set(MAIN, 0);
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration(MAIN, 1, [tableRemoved("Legacy")], false),
    ]);
    const client = createMockClient();
    const unchanged = { name: "Legacy", metaRequest: metaRequest(SUB, "Legacy") };

    await applyTailorDB(
      client,
      createMockPlanResult({ deletes: [deleteEntry(MAIN, "Legacy")], unchanged: [unchanged] }),
      "create-update",
    );

    expect(writtenMetadataTrns(client)).toContain(unchanged.metaRequest.trn);
  });
});
