/**
 * A migrating namespace must not accept GraphQL mutations or publish record
 * events from a shape that executors and callers cannot safely use. The
 * restrictions have to remain in place until every migration has settled.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { applyTailorDB, captureMigrationFileState } from "./index";
import type { DiffChange } from "#/cli/commands/tailordb/migrate/diff-calculator";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { Application } from "#/cli/services/application";
import type { TailorDBService } from "#/cli/services/tailordb/service";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";

const remoteCheckpoint = vi.hoisted(() => ({
  number: null as number | null,
  historyId: null as string | null,
}));

// Mock label.ts to suppress real metadata building
vi.mock("../label", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("../label");
  return {
    ...original,
    buildMetaRequest: vi.fn().mockImplementation(async () => ({
      trn: "trn:v1:workspace:test-workspace:tailordb:test-ns",
      labels: {},
    })),
  };
});

// Mock createChangeSet to suppress output in tests
vi.mock("../change-set", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("../change-set");
  return {
    ...original,
    createChangeSet: (title: string) => ({
      ...original.createChangeSet(title),
      lines: () => [],
    }),
  };
});

// Mock the migration helpers so applyTailorDB enters the migration flow without
// touching the filesystem or the remote workspace.
vi.mock("./migration", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./migration");
  return {
    ...original,
    detectPendingMigrations: vi.fn(),
    executeMigrations: vi.fn().mockResolvedValue(undefined),
    updateMigrationLabel: vi
      .fn()
      .mockImplementation(
        async (
          _client: unknown,
          _workspaceId: string,
          _namespace: string,
          number: number,
          historyId?: string,
        ) => {
          remoteCheckpoint.number = number;
          remoteCheckpoint.historyId = historyId ?? null;
        },
      ),
  };
});

// Mock migration config / snapshot helpers (called inside validateAndDetectMigrations)
vi.mock("#/cli/commands/tailordb/migrate/config", () => ({
  getNamespacesWithMigrations: vi.fn().mockReturnValue([
    {
      namespace: "test-ns",
      migrationsDir: "/test/migrations",
    },
  ]),
}));

// Per-test schema states keyed by migration number, so reconstruction returns
// the state as of the requested checkpoint like the real replay does.
const snapshotState = vi.hoisted(() => ({
  tablesByVersion: {} as Record<number, unknown>,
  historyId: null as string | null,
}));

vi.mock("#/cli/commands/tailordb/migrate/snapshot", async (importOriginal) => {
  const original =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    (await importOriginal()) as typeof import("#/cli/commands/tailordb/migrate/snapshot");
  return {
    ...original,
    assertValidMigrationFiles: vi.fn(),
    reconstructSnapshotFromMigrations: vi.fn((migrationsDir: string, maxVersion?: number) => {
      void migrationsDir;
      const versions = Object.keys(snapshotState.tablesByVersion).map(Number);
      const number = maxVersion ?? Math.max(...versions);
      const tables = snapshotState.tablesByVersion[number];
      if (!tables) {
        throw new Error(`No snapshot fixture configured for migration number: ${number}`);
      }
      return {
        version: 1,
        namespace: "test-ns",
        createdAt: "2026-01-01T00:00:00.000Z",
        tables,
        ...(snapshotState.historyId && {
          rebaseline: {
            historyId: snapshotState.historyId,
            replacedHistoryId: null,
            replacedLatestMigration: 0,
          },
        }),
      };
    }),
  };
});

import * as migrationModule from "./migration";

const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

describe("migration flow: namespace restrictions while migrations run", () => {
  type WrittenSettings = {
    bulkUpsert?: boolean;
    publishRecordEvents?: boolean;
    disableGqlOperations?: {
      create?: boolean;
      update?: boolean;
      delete?: boolean;
      read?: boolean;
    };
  };

  function createMockClient(
    options: {
      existingSettings?: Record<string, WrittenSettings>;
      existingTableNames?: string[];
    } = {},
  ) {
    return {
      createTailorDBService: vi.fn().mockResolvedValue({}),
      setMetadata: vi.fn().mockResolvedValue({}),
      getMetadata: vi.fn().mockImplementation(async () => ({
        metadata: {
          labels: {
            ...(remoteCheckpoint.number !== null && {
              "sdk-migration": `m${String(remoteCheckpoint.number).padStart(4, "0")}`,
            }),
            ...(remoteCheckpoint.historyId && {
              "sdk-migration-history": remoteCheckpoint.historyId,
            }),
          },
        },
      })),
      listTailorDBTypes: vi.fn().mockImplementation(async () => {
        const tables = snapshotState.tablesByVersion[0] as
          | Record<
              string,
              {
                settings?: {
                  bulkUpsert?: boolean;
                  publishEvents?: boolean;
                  gqlOperations?: {
                    create?: boolean;
                    update?: boolean;
                    delete?: boolean;
                    read?: boolean;
                  };
                };
              }
            >
          | undefined;
        const names = options.existingTableNames ?? Object.keys(tables ?? {});
        const tailordbTypes = names.map((name) => {
          const snapshotSettings = tables?.[name]?.settings;
          const operations = snapshotSettings?.gqlOperations;
          return {
            name,
            schema: {
              settings: {
                bulkUpsert: snapshotSettings?.bulkUpsert ?? false,
                publishRecordEvents: snapshotSettings?.publishEvents ?? false,
                ...(operations && {
                  disableGqlOperations: {
                    create: operations.create === false,
                    update: operations.update === false,
                    delete: operations.delete === false,
                    read: operations.read === false,
                  },
                }),
                ...options.existingSettings?.[name],
              },
            },
          };
        });
        return { tailordbTypes };
      }),
      createTailorDBType: vi.fn().mockResolvedValue({}),
      updateTailorDBType: vi.fn().mockResolvedValue({}),
      createTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      updateTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBType: vi.fn().mockResolvedValue({}),
      deleteTailorDBService: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  function snapshotTable(
    name: string,
    fields: Record<string, { type: string; required: boolean }>,
    settings?: {
      bulkUpsert?: boolean;
      publishEvents?: boolean;
      gqlOperations?: {
        create?: boolean;
        update?: boolean;
        delete?: boolean;
        read?: boolean;
      };
    },
  ) {
    return { name, pluralForm: `${name.toLowerCase()}s`, fields, ...(settings && { settings }) };
  }

  function typeCreate(tableName: string) {
    return {
      name: tableName,
      request: {
        workspaceId: "test-workspace",
        namespaceName: "test-ns",
        tailordbType: {
          name: tableName,
          schema: {
            fields: { name: { type: "string", required: true } },
          },
        },
      },
      metaRequest: {
        trn: `trn:v1:workspace:test-workspace:tailordb:test-ns:type:${tableName}`,
        labels: { "sdk-name": "test-app" },
      },
    };
  }

  function createMockPlanResult(options: {
    creates: string[];
    updates?: string[];
    gqlPermissionTypes?: string[];
    /** Tables an enabled executor subscribes to, so publishing is on for them. */
    subscribedTables?: string[];
  }) {
    const migratedService = {
      namespace: "test-ns",
      loadTypes: vi.fn().mockResolvedValue({}),
      types: {},
    } as unknown as TailorDBService;

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
          creates: options.creates.map(typeCreate),
          updates: (options.updates ?? []).map(typeCreate),
          deletes: [],
          unchanged: [],
          title: "TailorDB Types",
          isEmpty: () => false,
          lines: () => [],
        },
        gqlPermission: {
          creates: (options.gqlPermissionTypes ?? []).map((tableName) => ({
            name: tableName,
            request: {
              workspaceId: "test-workspace",
              namespaceName: "test-ns",
              typeName: tableName,
              permission: {},
            },
          })),
          updates: [],
          deletes: [],
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
          tailorDBServices: [migratedService],
          authService: {
            config: { name: "test-auth", machineUsers: { admin: {} } },
          },
        } as unknown as Application,
        // The restore step reads the final schema from here, the way the real
        // plan supplies it.
        tailorDBInputs: [
          {
            namespace: "test-ns",
            config: {} as never,
            types: Object.fromEntries(
              [...options.creates, ...(options.updates ?? [])].map((name) => [
                name,
                snapshotTable(name, { status: { type: "string", required: true } }),
              ]),
            ),
          },
        ] as never,
        executorUsedTables: new Set<string>(options.subscribedTables ?? []),
        config: mockConfig,
        noSchemaCheck: true,
        checkpointRepairs: [],
        namespacesWithMigrations: [{ namespace: "test-ns", migrationsDir: "/test/migrations" }],
        migrationFileState: captureMigrationFileState([
          { namespace: "test-ns", migrationsDir: "/test/migrations" },
        ]),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  function mkPendingMigration(
    changes: DiffChange[],
    options: { number?: number; hasScript?: boolean } = {},
  ): PendingMigration {
    const number = options.number ?? 1;
    const label = String(number).padStart(4, "0");
    return {
      number,
      scriptPath: `/test/migrations/${label}/migrate.ts`,
      diffPath: `/test/migrations/${label}/diff.json`,
      namespace: "test-ns",
      migrationsDir: "/test/migrations",
      hasScript: options.hasScript ?? true,
      diff: {
        version: 1,
        namespace: "test-ns",
        createdAt: "2026-01-01T00:00:00.000Z",
        changes,
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    };
  }

  function typeSettingWrites(client: OperatorClient) {
    const writes: Array<{
      order: number;
      entry: readonly [string, WrittenSettings | undefined];
    }> = [];
    for (const fn of [client.createTailorDBType, client.updateTailorDBType]) {
      const mock = vi.mocked(fn);
      mock.mock.calls.forEach((call, index) => {
        const request = call[0];
        const name = request.tailordbType?.name;
        if (name === undefined) return;
        writes.push({
          order: mock.mock.invocationCallOrder[index]!,
          entry: [name, request.tailordbType?.schema?.settings],
        });
      });
    }
    return writes.toSorted((a, b) => a.order - b.order).map(({ entry }) => entry);
  }

  function publishFlagWrites(client: OperatorClient): Array<[string, boolean | undefined]> {
    return typeSettingWrites(client).map(([name, settings]) => [
      name,
      settings?.publishRecordEvents,
    ]);
  }

  function gqlOperationWrites(client: OperatorClient) {
    return typeSettingWrites(client).map(
      ([name, settings]) => [name, settings?.disableGqlOperations] as const,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    snapshotState.tablesByVersion = {};
    snapshotState.historyId = null;
    remoteCheckpoint.number = null;
    remoteCheckpoint.historyId = null;
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(
      async (_client, _workspaceId, _namespace, number, historyId) => {
        remoteCheckpoint.number = number;
        remoteCheckpoint.historyId = historyId ?? null;
      },
    );
  });

  test("turns publishing back on once the migrations have settled", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({
      creates: ["Order"],
      subscribedTables: ["Order"],
    });
    snapshotState.tablesByVersion = {
      0: {},
      1: { Order: snapshotTable("Order", { status: { type: "string", required: true } }) },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([
        { kind: "table_added", tableName: "Order" },
        // A required field forces a pre-phase relaxation and a post-phase
        // re-send, so the table is written more than once per migration.
        {
          kind: "field_added",
          tableName: "Order",
          fieldName: "status",
          after: { type: "string", required: true },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const orderWrites = publishFlagWrites(client).filter(([name]) => name === "Order");
    expect(orderWrites.length).toBeGreaterThan(0);

    // Nothing may observe events from a shape that is mid-migration...
    expect(orderWrites.slice(0, -1).map(([, flag]) => flag)).not.toContain(true);

    // ...and the state deploy leaves behind has to publish again.
    expect(orderWrites.at(-1)?.[1]).toBe(true);

    const operationWrites = gqlOperationWrites(client).filter(([name]) => name === "Order");
    expect(operationWrites.length).toBeGreaterThan(0);
    for (const [, operations] of operationWrites.slice(0, -1)) {
      expect(operations).toEqual({ create: true, update: true, delete: true, read: false });
    }
    expect(operationWrites.at(-1)?.[1]).toBeUndefined();
  });

  test("restricts the old table before a rename and restores the surviving table", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({
      creates: ["Invoice"],
      subscribedTables: ["Invoice"],
    });
    snapshotState.tablesByVersion = {
      0: { Bill: snapshotTable("Bill", { status: { type: "string", required: true } }) },
      1: { Invoice: snapshotTable("Invoice", { status: { type: "string", required: true } }) },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([
        // The change names the table it becomes, so that is the one to restore;
        // the old name is dropped and must not be written back.
        { kind: "table_renamed", tableName: "Invoice", previousTableName: "Bill" },
        {
          kind: "field_added",
          tableName: "Invoice",
          fieldName: "status",
          after: { type: "string", required: true },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const writes = publishFlagWrites(client);
    expect(writes[0]).toEqual(["Bill", false]);
    expect(writes.at(-1)).toEqual(["Invoice", true]);
  });

  test("creates checkpoint tables with restrictions already applied", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({ creates: ["Order"], subscribedTables: ["Order"] });
    const table = snapshotTable("Order", { status: { type: "string", required: true } });
    snapshotState.tablesByVersion = { 0: { Order: table }, 1: { Order: table } };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration([])]);

    await applyTailorDB(client, planResult, "create-update");

    const firstWrite = typeSettingWrites(client).find(([name]) => name === "Order");
    expect(firstWrite).toEqual([
      "Order",
      expect.objectContaining({
        publishRecordEvents: false,
        disableGqlOperations: { create: true, update: true, delete: true, read: false },
      }),
    ]);
  });

  test("does not validate the checkpoint's publishing setting while applying restrictions", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({
      creates: [],
      updates: ["Order"],
      subscribedTables: ["Order"],
    });
    const before = snapshotTable(
      "Order",
      { status: { type: "string", required: true } },
      { publishEvents: false },
    );
    const after = snapshotTable(
      "Order",
      { status: { type: "string", required: true } },
      { publishEvents: true },
    );
    snapshotState.tablesByVersion = { 0: { Order: before }, 1: { Order: after } };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { kind: "table_settings_modified", tableName: "Order" } as any,
      ]),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    expect(publishFlagWrites(client).filter(([name]) => name === "Order")).toEqual([
      ["Order", false],
      ["Order", false],
      ["Order", true],
    ]);
  });

  test("does not create a later migration's permission table before that migration", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({
      creates: ["Future"],
      gqlPermissionTypes: ["Future"],
    });
    const current = snapshotTable("Current", { value: { type: "string", required: true } });
    const future = snapshotTable("Future", { value: { type: "string", required: true } });
    snapshotState.tablesByVersion = {
      0: { Current: current },
      1: { Current: current },
      2: { Current: current, Future: future },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([], { number: 1 }),
      mkPendingMigration(
        [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { kind: "table_added", tableName: "Future" } as any,
        ],
        { number: 2 },
      ),
    ]);
    const order: string[] = [];
    vi.mocked(migrationModule.executeMigrations).mockImplementation(async () => {
      order.push("script");
    });
    vi.mocked(client.createTailorDBType).mockImplementation(async (request) => {
      if (request.tailordbType?.name === "Future") {
        order.push("create Future");
      }
      return {} as never;
    });

    await applyTailorDB(client, planResult, "create-update");

    expect(order).toEqual(["script", "create Future", "script"]);
    const futureWrite = typeSettingWrites(client).find(([name]) => name === "Future");
    expect(futureWrite?.[1]).toMatchObject({
      bulkUpsert: false,
      publishRecordEvents: false,
      disableGqlOperations: { create: true, update: true, delete: true, read: false },
    });
  });

  test("creates a planned no-schema-check table after unrelated migrations settle", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({
      creates: ["Untracked"],
      gqlPermissionTypes: ["Untracked"],
    });
    const current = snapshotTable("Current", { value: { type: "string", required: true } });
    snapshotState.tablesByVersion = { 0: { Current: current }, 1: { Current: current } };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration([])]);
    const order: string[] = [];
    vi.mocked(migrationModule.executeMigrations).mockImplementation(async () => {
      order.push("script");
    });
    vi.mocked(client.createTailorDBType).mockImplementation(async (request) => {
      if (request.tailordbType?.name === "Untracked") order.push("create");
      return {} as never;
    });
    vi.mocked(client.createTailorDBGQLPermission).mockImplementation(async (request) => {
      if (request.typeName === "Untracked") order.push("permission");
      return {} as never;
    });

    await applyTailorDB(client, planResult, "create-update");

    expect(order).toEqual(["script", "create", "permission"]);
  });

  test("silences a table that declares publishEvents, then restores it", async () => {
    const client = createMockClient();
    // No executor subscribes: `publishEvents: true` publishes on its own, so
    // `subscribed: false` alone would not silence it.
    const planResult = createMockPlanResult({ creates: ["Order"] });
    const declaring = snapshotTable(
      "Order",
      { status: { type: "string", required: true } },
      { publishEvents: true },
    );
    snapshotState.tablesByVersion = { 0: { Order: declaring }, 1: { Order: declaring } };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([
        { kind: "table_added", tableName: "Order" },
        {
          kind: "field_added",
          tableName: "Order",
          fieldName: "status",
          after: { type: "string", required: true },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const flags = publishFlagWrites(client).filter(([name]) => name === "Order");
    // From the first silencing write until the restore, nothing publishes.
    const silenced = flags.slice(flags.findIndex(([, flag]) => flag === false));
    expect(silenced.length).toBeGreaterThan(1);
    expect(silenced.slice(0, -1).map(([, flag]) => flag)).not.toContain(true);
    expect(flags.at(-1)?.[1]).toBe(true);
  });

  test("silences the namespace for a migration that carries no schema diff", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({ creates: [], subscribedTables: ["Order"] });
    const table = snapshotTable("Order", { status: { type: "string", required: true } });
    snapshotState.tablesByVersion = { 0: { Order: table }, 1: { Order: table } };
    // A data-only migration carries an empty diff, so nothing names Order.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration([])]);

    await applyTailorDB(client, planResult, "create-update");

    const flags = publishFlagWrites(client).filter(([name]) => name === "Order");
    expect(flags.length).toBeGreaterThan(1);
    expect(flags[0]?.[1]).toBe(false);
    expect(flags.at(-1)?.[1]).toBe(true);
  });

  test("restricts and restores an active no-schema-check table outside the snapshot", async () => {
    const client = createMockClient({
      existingTableNames: ["Order", "Drift"],
      existingSettings: { Drift: { publishRecordEvents: true } },
    });
    const planResult = createMockPlanResult({ creates: [] });
    planResult.changeSet.gqlPermission.updates.push({
      name: "Drift",
      request: {
        workspaceId: "test-workspace",
        namespaceName: "test-ns",
        typeName: "Drift",
        permission: {},
      },
    });
    const order = snapshotTable("Order", { status: { type: "string", required: true } });
    snapshotState.tablesByVersion = { 0: { Order: order }, 1: { Order: order } };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration([])]);

    await applyTailorDB(client, planResult, "create-update");

    expect(publishFlagWrites(client).filter(([name]) => name === "Drift")).toEqual([
      ["Drift", false],
      ["Drift", true],
    ]);
    expect(client.updateTailorDBGQLPermission).toHaveBeenCalledWith(
      expect.objectContaining({ typeName: "Drift" }),
    );
  });

  test("makes the namespace read-only while a data-only migration runs", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({ creates: [] });
    const order = snapshotTable("Order", { status: { type: "string", required: true } });
    const privateLog = snapshotTable(
      "PrivateLog",
      { message: { type: "string", required: true } },
      { gqlOperations: { read: false } },
    );
    snapshotState.tablesByVersion = {
      0: { Order: order, PrivateLog: privateLog },
      1: { Order: order, PrivateLog: privateLog },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration([])]);

    await applyTailorDB(client, planResult, "create-update");

    const writes = gqlOperationWrites(client);
    expect(writes.filter(([name]) => name === "Order").map(([, operations]) => operations)).toEqual(
      [{ create: true, update: true, delete: true, read: false }, undefined],
    );
    expect(
      writes.filter(([name]) => name === "PrivateLog").map(([, operations]) => operations),
    ).toEqual([
      { create: true, update: true, delete: true, read: true },
      { create: false, update: false, delete: false, read: true },
    ]);
  });

  test("restores publishing when a migration fails partway", async () => {
    const client = createMockClient({
      existingSettings: { Order: { publishRecordEvents: true } },
    });
    const planResult = createMockPlanResult({ creates: ["Order"], subscribedTables: ["Order"] });
    const table = snapshotTable("Order", { status: { type: "string", required: true } });
    snapshotState.tablesByVersion = { 0: { Order: table }, 1: { Order: table } };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_added", tableName: "Order" } as any], { hasScript: true }),
    ]);
    // The checkpoint update has no rollback: it fails with the schema applied,
    // so only a `finally` can put publishing back.
    vi.mocked(migrationModule.updateMigrationLabel).mockRejectedValueOnce(
      new Error("checkpoint update failed"),
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /checkpoint update failed/,
    );

    // A committed checkpoint drops its migration from the next run's pending
    // set, so publishing has to come back on before the throw escapes.
    const flags = publishFlagWrites(client).filter(([name]) => name === "Order");
    expect(flags.at(-1)?.[1]).toBe(true);
    expect(
      gqlOperationWrites(client)
        .filter(([name]) => name === "Order")
        .at(-1)?.[1],
    ).toBeUndefined();
  });

  test("restores a not-yet-deleted table when its checkpoint remains uncommitted", async () => {
    const client = createMockClient({
      existingSettings: { Retired: { publishRecordEvents: true } },
    });
    const planResult = createMockPlanResult({ creates: [] });
    const keep = snapshotTable("Keep", { value: { type: "string", required: true } });
    const retired = snapshotTable("Retired", { value: { type: "string", required: true } });
    snapshotState.tablesByVersion = {
      0: { Keep: keep, Retired: retired },
      1: { Keep: keep },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { kind: "table_removed", tableName: "Retired" } as any,
      ]),
    ]);
    vi.mocked(migrationModule.updateMigrationLabel).mockRejectedValueOnce(
      new Error("checkpoint update failed"),
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /checkpoint update failed/,
    );

    const retiredWrites = typeSettingWrites(client).filter(([name]) => name === "Retired");
    expect(retiredWrites.at(-1)?.[1]).toMatchObject({
      publishRecordEvents: true,
    });
    expect(retiredWrites.at(-1)?.[1]?.disableGqlOperations).toBeUndefined();
  });

  test("restores restrictions when a failed checkpoint cannot be read back", async () => {
    const client = createMockClient({
      existingSettings: { Order: { publishRecordEvents: true } },
    });
    const planResult = createMockPlanResult({ creates: [] });
    const order = snapshotTable("Order", { value: { type: "string", required: true } });
    snapshotState.tablesByVersion = { 0: { Order: order }, 1: { Order: order } };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration([])]);
    vi.mocked(migrationModule.updateMigrationLabel).mockRejectedValueOnce(
      new Error("checkpoint update failed"),
    );
    vi.mocked(client.getMetadata).mockRejectedValueOnce(new Error("checkpoint readback failed"));

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /checkpoint update failed/,
    );

    const writes = typeSettingWrites(client).filter(([name]) => name === "Order");
    expect(writes.at(-1)?.[1]).toMatchObject({ publishRecordEvents: true });
    expect(writes.at(-1)?.[1]?.disableGqlOperations).toBeUndefined();
  });

  test("rejects the same checkpoint number from a different migration history", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({ creates: [] });
    const retired = snapshotTable("Retired", { value: { type: "string", required: true } });
    snapshotState.historyId = "hlocal";
    snapshotState.tablesByVersion = { 0: { Retired: retired }, 1: {} };
    planResult.changeSet.type.deletes.push({
      name: "Retired",
      request: {
        workspaceId: "test-workspace",
        namespaceName: "test-ns",
        tailordbTypeName: "Retired",
      },
    });
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { kind: "table_removed", tableName: "Retired" } as any,
      ]),
    ]);
    vi.mocked(migrationModule.updateMigrationLabel).mockRejectedValueOnce(
      new Error("checkpoint update failed"),
    );
    vi.mocked(client.getMetadata).mockResolvedValueOnce({
      metadata: {
        labels: {
          "sdk-migration": "m0001",
          "sdk-migration-history": "hother",
        },
      },
    } as never);

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /advanced concurrently.*history/i,
    );
    expect(client.deleteTailorDBType).not.toHaveBeenCalled();
  });

  test("does not restore over a checkpoint that advances after this migration commits", async () => {
    const client = createMockClient({
      existingSettings: { Order: { publishRecordEvents: true } },
    });
    const planResult = createMockPlanResult({ creates: [] });
    const order = snapshotTable("Order", { value: { type: "string", required: true } });
    snapshotState.tablesByVersion = { 0: { Order: order }, 1: { Order: order } };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration([])]);
    vi.mocked(client.getMetadata).mockResolvedValueOnce({
      metadata: { labels: { "sdk-migration": "m0002" } },
    } as never);

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /advanced concurrently to 0002/i,
    );
    expect(publishFlagWrites(client).filter(([name]) => name === "Order")).toEqual([
      ["Order", false],
    ]);
  });

  test("restores a deleted table when post-checkpoint cleanup fails", async () => {
    const client = createMockClient({
      existingSettings: { Retired: { publishRecordEvents: true } },
    });
    const planResult = createMockPlanResult({ creates: [] });
    const retired = snapshotTable("Retired", { value: { type: "string", required: true } });
    snapshotState.tablesByVersion = { 0: { Retired: retired }, 1: {} };
    planResult.changeSet.type.deletes.push({
      name: "Retired",
      request: {
        workspaceId: "test-workspace",
        namespaceName: "test-ns",
        tailordbTypeName: "Retired",
      },
    });
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { kind: "table_removed", tableName: "Retired" } as any,
      ]),
    ]);
    vi.mocked(client.deleteTailorDBType).mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /cleanup failed/,
    );

    expect(publishFlagWrites(client).filter(([name]) => name === "Retired")).toEqual([
      ["Retired", false],
      ["Retired", true],
    ]);
  });

  test("restores tables already restricted when applying another restriction fails", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({ creates: [] });
    const order = snapshotTable("Order", { status: { type: "string", required: true } });
    const log = snapshotTable("Log", { message: { type: "string", required: true } });
    snapshotState.tablesByVersion = {
      0: { Order: order, Log: log },
      1: { Order: order, Log: log },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration([])]);
    let restrictionFailed = false;
    vi.mocked(client.updateTailorDBType).mockImplementation(async (request) => {
      if (
        !restrictionFailed &&
        request.tailordbType?.name === "Log" &&
        request.tailordbType.schema?.settings?.publishRecordEvents === false
      ) {
        restrictionFailed = true;
        throw new Error("restriction failed");
      }
      return {} as never;
    });

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /restriction failed/,
    );

    const orderFlags = publishFlagWrites(client)
      .filter(([name]) => name === "Order")
      .map(([, flag]) => flag);
    expect(orderFlags).toEqual([false, false]);
    expect(
      gqlOperationWrites(client)
        .filter(([name]) => name === "Order")
        .at(-1)?.[1],
    ).toBeUndefined();
  });

  test("keeps rollback writes restricted until failure restoration completes", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({ creates: [], updates: ["Order"] });
    snapshotState.tablesByVersion = {
      0: { Order: snapshotTable("Order", { status: { type: "string", required: true } }) },
      1: {
        Order: snapshotTable("Order", {
          status: { type: "string", required: true },
          requiredLater: { type: "string", required: true },
        }),
      },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([
        {
          kind: "field_added",
          tableName: "Order",
          fieldName: "requiredLater",
          after: { type: "string", required: true },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValueOnce(new Error("script failed"));

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /script failed/,
    );

    const flags = publishFlagWrites(client)
      .filter(([name]) => name === "Order")
      .map(([, flag]) => flag);
    expect(flags.length).toBeGreaterThan(2);
    expect(flags.slice(0, -1)).toEqual(flags.slice(0, -1).map(() => false));
    expect(flags.at(-1)).toBe(false);
    const operationWrites = gqlOperationWrites(client)
      .filter(([name]) => name === "Order")
      .map(([, operations]) => operations);
    expect(operationWrites.slice(0, -1)).toEqual(
      operationWrites.slice(0, -1).map(() => ({
        create: true,
        update: true,
        delete: true,
        read: false,
      })),
    );
    expect(operationWrites.at(-1)).toBeUndefined();
  });

  test("restores the exact pre-deploy settings and preserves a disabled read operation", async () => {
    const originalSettings = {
      bulkUpsert: true,
      publishRecordEvents: false,
      disableGqlOperations: { create: false, update: true, delete: false, read: true },
    };
    const client = createMockClient({ existingSettings: { Order: originalSettings } });
    const planResult = createMockPlanResult({ creates: [], updates: ["Order"] });
    snapshotState.tablesByVersion = {
      0: {
        Order: snapshotTable(
          "Order",
          { status: { type: "string", required: true } },
          { bulkUpsert: true },
        ),
      },
      1: {
        Order: snapshotTable(
          "Order",
          {
            status: { type: "string", required: true },
            requiredLater: { type: "string", required: true },
          },
          { bulkUpsert: true },
        ),
      },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([
        {
          kind: "field_added",
          tableName: "Order",
          fieldName: "requiredLater",
          after: { type: "string", required: true },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValueOnce(new Error("script failed"));

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /script failed/,
    );

    const writes = typeSettingWrites(client).filter(([name]) => name === "Order");
    expect(writes.length).toBeGreaterThan(2);
    for (const [, settings] of writes.slice(0, -1)) {
      expect(settings).toMatchObject({
        bulkUpsert: false,
        publishRecordEvents: false,
        disableGqlOperations: { create: true, update: true, delete: true, read: true },
      });
    }
    expect(writes.at(-1)?.[1]).toMatchObject(originalSettings);
  });

  test("does not restrict a historical table that is absent from the workspace", async () => {
    const client = createMockClient({ existingTableNames: [] });
    const planResult = createMockPlanResult({ creates: ["Current"] });
    const current = snapshotTable("Current", { value: { type: "string", required: true } });
    snapshotState.tablesByVersion = {
      0: {
        Current: current,
        Historical: snapshotTable("Historical", {
          value: { type: "string", required: true },
        }),
      },
      1: { Current: current },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { kind: "table_removed", tableName: "Historical" } as any,
      ]),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    expect(
      vi
        .mocked(client.updateTailorDBType)
        .mock.calls.some(([request]) => request.tailordbType?.name === "Historical"),
    ).toBe(false);
  });

  test("continues restoration and preserves the migration error when one table restore fails", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({ creates: [] });
    const order = snapshotTable("Order", { value: { type: "string", required: true } });
    const log = snapshotTable("Log", { value: { type: "string", required: true } });
    snapshotState.tablesByVersion = {
      0: { Order: order, Log: log },
      1: { Order: order, Log: log },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration([])]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValueOnce(
      new Error("original migration failure"),
    );
    vi.mocked(client.updateTailorDBType).mockImplementation(async (request) => {
      const settings = request.tailordbType?.schema?.settings;
      if (request.tailordbType?.name === "Order" && settings?.disableGqlOperations === undefined) {
        throw new Error("Order restore failed");
      }
      return {} as never;
    });

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /original migration failure/,
    );

    expect(
      gqlOperationWrites(client)
        .filter(([name]) => name === "Log")
        .at(-1)?.[1],
    ).toBeUndefined();
  });

  test("restores the last settled snapshot when a later migration fails", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({ creates: [] });
    snapshotState.tablesByVersion = {
      0: { Order: snapshotTable("Order", { initial: { type: "string", required: true } }) },
      1: {
        Order: snapshotTable("Order", {
          initial: { type: "string", required: true },
          settled: { type: "string", required: true },
        }),
      },
      2: {
        Order: snapshotTable("Order", {
          initial: { type: "string", required: true },
          settled: { type: "string", required: true },
          notSettled: { type: "string", required: true },
        }),
      },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([], { number: 1 }),
      mkPendingMigration([], { number: 2 }),
    ]);
    vi.mocked(migrationModule.executeMigrations)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("second script failed"));

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /second script failed/,
    );

    const lastOrderWrite = vi
      .mocked(client.updateTailorDBType)
      .mock.calls.map(([request]) => request)
      .filter((request) => request.tailordbType?.name === "Order")
      .at(-1);
    expect(lastOrderWrite?.tailordbType?.schema?.fields).toHaveProperty("settled");
    expect(lastOrderWrite?.tailordbType?.schema?.fields).not.toHaveProperty("notSettled");
  });

  test("restores settings from the last committed migration when a later one fails", async () => {
    const client = createMockClient({
      existingSettings: {
        Order: {
          bulkUpsert: false,
          publishRecordEvents: false,
        },
      },
    });
    const planResult = createMockPlanResult({ creates: [], updates: ["Order"] });
    const initial = snapshotTable(
      "Order",
      { value: { type: "string", required: true } },
      { bulkUpsert: false, publishEvents: false },
    );
    const committed = snapshotTable(
      "Order",
      { value: { type: "string", required: true } },
      {
        bulkUpsert: true,
        publishEvents: true,
        gqlOperations: { create: false, read: false },
      },
    );
    snapshotState.tablesByVersion = {
      0: { Order: initial },
      1: { Order: committed },
      2: { Order: committed },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration(
        [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { kind: "table_settings_modified", tableName: "Order" } as any,
        ],
        { number: 1 },
      ),
      mkPendingMigration([], { number: 2 }),
    ]);
    vi.mocked(migrationModule.executeMigrations)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("second script failed"));

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /second script failed/,
    );

    const finalSettings = typeSettingWrites(client)
      .filter(([name]) => name === "Order")
      .at(-1)?.[1];
    expect(finalSettings).toMatchObject({
      bulkUpsert: true,
      publishRecordEvents: true,
      disableGqlOperations: { create: true, update: false, delete: false, read: true },
    });
  });

  test("restores a table that is removed and re-added in the same run", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({ creates: [], updates: ["Order"] });
    const order = snapshotTable("Order", { status: { type: "string", required: true } });
    snapshotState.tablesByVersion = { 0: { Order: order }, 1: {}, 2: { Order: order } };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration(
        [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { kind: "table_removed", tableName: "Order" } as any,
        ],
        { number: 1 },
      ),
      mkPendingMigration(
        [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { kind: "table_added", tableName: "Order" } as any,
        ],
        { number: 2 },
      ),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const flags = publishFlagWrites(client)
      .filter(([name]) => name === "Order")
      .map(([, flag]) => flag);
    expect(flags[0]).toBe(false);
    expect(flags.at(-1)).toBe(false);
    expect(
      gqlOperationWrites(client)
        .filter(([name]) => name === "Order")
        .at(-1)?.[1],
    ).toBeUndefined();
  });

  test("leaves publishing off for a table nothing subscribes to", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({ creates: ["Order"] });
    snapshotState.tablesByVersion = {
      0: {},
      1: { Order: snapshotTable("Order", { status: { type: "string", required: true } }) },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([
        { kind: "table_added", tableName: "Order" },
        // A required field forces a pre-phase relaxation and a post-phase
        // re-send, so the table is written more than once per migration.
        {
          kind: "field_added",
          tableName: "Order",
          fieldName: "status",
          after: { type: "string", required: true },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const flags = publishFlagWrites(client)
      .filter(([name]) => name === "Order")
      .map(([, flag]) => flag);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags).not.toContain(true);
  });
});
