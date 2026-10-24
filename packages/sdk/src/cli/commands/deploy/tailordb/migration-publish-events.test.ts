/**
 * A migrating namespace must not accept GraphQL mutations or publish record
 * events from a shape that executors and callers cannot safely use. The
 * restrictions have to remain in place until every migration has settled.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { reconstructSnapshotFromMigrations } from "#/cli/commands/tailordb/migrate/snapshot";
import { errorToJson } from "#/cli/shared/error-json";
import { captureStderr } from "#/cli/shared/test-helpers/capture-output";
import * as migrationModule from "./migration";
import {
  createPlanResult,
  createRemoteCheckpoint,
  gqlPermissionEntry,
  mkPendingMigration,
  mockConfig,
  type RemoteCheckpoint,
  snapshotAt,
  snapshotTable,
  typeEntry,
} from "./test-helpers/migration-apply";
import { applyTailorDB, type MaintenanceModeRelease } from "./index";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";

vi.mock("./migration", async (importOriginal) => ({
  ...(await importOriginal()),
  detectPendingMigrations: vi.fn(),
  executeMigrations: vi.fn().mockResolvedValue(undefined),
  updateMigrationLabel: vi.fn(),
}));

vi.mock("#/cli/commands/tailordb/migrate/config", () => ({
  getNamespacesWithMigrations: vi.fn(() => [
    { namespace: "test-ns", migrationsDir: "/test/migrations" },
  ]),
}));

vi.mock("#/cli/commands/tailordb/migrate/snapshot", async (importOriginal) => ({
  ...(await importOriginal()),
  assertValidMigrationFiles: vi.fn(),
  reconstructSnapshotFromMigrations: vi.fn(),
}));

// Per-test schema states keyed by migration number, so reconstruction returns
// the state as of the requested checkpoint like the real replay does.
const snapshotState = {
  tablesByVersion: {} as Record<number, unknown>,
  historyId: null as string | null,
};

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

  let checkpoint: RemoteCheckpoint;

  function createMockClient(
    options: {
      existingSettings?: Record<string, WrittenSettings>;
      existingTableNames?: string[];
    } = {},
  ) {
    return checkpoint.createMockClient({
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
    });
  }

  function createMockPlanResult(options: {
    creates: string[];
    updates?: string[];
    gqlPermissionTypes?: string[];
    /** Tables an enabled executor subscribes to, so publishing is on for them. */
    subscribedTables?: string[];
    /** Defaults to "migration"; pass `undefined` explicitly to leave it unset. */
    maintenanceMode?: LoadedConfig["maintenanceMode"];
  }) {
    return createPlanResult({
      type: {
        creates: options.creates.map((name) => typeEntry(name)),
        updates: (options.updates ?? []).map((name) => typeEntry(name)),
      },
      gqlPermission: {
        creates: (options.gqlPermissionTypes ?? []).map((name) => gqlPermissionEntry(name)),
      },
      context: {
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
        config: {
          ...mockConfig,
          maintenanceMode: "maintenanceMode" in options ? options.maintenanceMode : "migration",
        },
      },
    });
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

  function lastOrderSettings(client: OperatorClient) {
    return typeSettingWrites(client)
      .filter(([name]) => name === "Order")
      .at(-1)?.[1];
  }

  beforeEach(() => {
    snapshotState.tablesByVersion = {};
    snapshotState.historyId = null;
    checkpoint = createRemoteCheckpoint(0);
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
    vi.mocked(reconstructSnapshotFromMigrations).mockImplementation(
      (_migrationsDir, maxVersion) => ({
        ...snapshotAt(snapshotState.tablesByVersion, maxVersion),
        ...(snapshotState.historyId && {
          rebaseline: {
            historyId: snapshotState.historyId,
            replacedHistoryId: null,
            replacedLatestMigration: 0,
          },
        }),
      }),
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

  test("does not validate the checkpoint's publishing setting while restoring it after a failure", async () => {
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
    const after = snapshotTable("Order", { status: { type: "string", required: true } });
    snapshotState.tablesByVersion = { 0: { Order: before }, 1: { Order: after } };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { kind: "table_settings_modified", tableName: "Order" } as any,
      ]),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValueOnce(new Error("script failed"));

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /script failed/,
    );

    expect(lastOrderSettings(client)).toEqual(
      expect.objectContaining({ publishRecordEvents: false, disableGqlOperations: undefined }),
    );
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

  test("normalizes a captured disableGqlOperations field that is not a boolean", async () => {
    const client = createMockClient({
      existingTableNames: ["Order", "Drift"],
      existingSettings: {
        Drift: {
          disableGqlOperations: {
            create: undefined,
            update: false,
            delete: false,
            read: false,
          },
        },
      },
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

    const driftWrites = gqlOperationWrites(client).filter(([name]) => name === "Drift");
    expect(driftWrites.at(-1)?.[1]).toEqual({
      create: false,
      update: false,
      delete: false,
      read: false,
    });
  });

  test("locks the namespace while a data-only migration runs", async () => {
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
    checkpoint.state.historyId = "hlocal";
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

  test("rejects a lower checkpoint from a different migration history", async () => {
    const client = createMockClient({
      existingSettings: { Order: { publishRecordEvents: true } },
    });
    const planResult = createMockPlanResult({ creates: [] });
    const order = snapshotTable("Order", { value: { type: "string", required: true } });
    snapshotState.historyId = "hlocal";
    checkpoint.state.historyId = "hlocal";
    snapshotState.tablesByVersion = { 0: { Order: order }, 1: { Order: order } };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration([])]);
    vi.mocked(migrationModule.updateMigrationLabel).mockRejectedValueOnce(
      new Error("checkpoint update failed"),
    );
    vi.mocked(client.getMetadata).mockResolvedValueOnce({
      metadata: {
        labels: {
          "sdk-migration": "m0000",
          "sdk-migration-history": "hother",
        },
      },
    } as never);

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /advanced concurrently.*history/i,
    );
    expect(publishFlagWrites(client).filter(([name]) => name === "Order")).toEqual([
      ["Order", false],
    ]);
  });

  test("does not restore when checkpoint ownership cannot be verified", async () => {
    const client = createMockClient({
      existingSettings: { Order: { publishRecordEvents: true } },
    });
    const planResult = createMockPlanResult({ creates: [] });
    const order = snapshotTable("Order", { value: { type: "string", required: true } });
    snapshotState.tablesByVersion = { 0: { Order: order }, 1: { Order: order } };
    checkpoint.state.number = 0;
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration([])]);
    vi.mocked(client.getMetadata).mockRejectedValueOnce(new Error("ownership read failed"));

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /Could not verify ownership.*ownership read failed/i,
    );
    expect(publishFlagWrites(client).filter(([name]) => name === "Order")).toEqual([
      ["Order", false],
    ]);
  });

  test("does not restore over a checkpoint that advances before the first migration commits", async () => {
    const client = createMockClient({
      existingSettings: { Order: { publishRecordEvents: true } },
    });
    const planResult = createMockPlanResult({ creates: [] });
    const order = snapshotTable("Order", { value: { type: "string", required: true } });
    snapshotState.tablesByVersion = { 0: { Order: order }, 1: { Order: order } };
    checkpoint.state.number = 0;
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([], { hasScript: true }),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockImplementationOnce(async () => {
      checkpoint.state.number = 2;
      throw new Error("migration failed");
    });

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /migration failed/,
    );
    expect(publishFlagWrites(client).filter(([name]) => name === "Order")).toEqual([
      ["Order", false],
    ]);
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

  test("leaves a deleted table locked when post-checkpoint cleanup fails", async () => {
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
          { bulkUpsert: true, gqlOperations: { read: false } },
        ),
      },
      1: {
        Order: snapshotTable(
          "Order",
          {
            status: { type: "string", required: true },
            requiredLater: { type: "string", required: true },
          },
          { bulkUpsert: true, gqlOperations: { read: false } },
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

  test("keeps a table readable when its live settings do not list any disabled operation, even if the snapshot disables read", async () => {
    const client = createMockClient({
      existingSettings: {
        Order: { bulkUpsert: true, publishRecordEvents: true, disableGqlOperations: undefined },
      },
    });
    const planResult = createMockPlanResult({ creates: [], updates: ["Order"] });
    const driftedSnapshot = (fields: Parameters<typeof snapshotTable>[1]) =>
      snapshotTable("Order", fields, { bulkUpsert: true, gqlOperations: { read: false } });
    snapshotState.tablesByVersion = {
      0: { Order: driftedSnapshot({ status: { type: "string", required: true } }) },
      1: {
        Order: driftedSnapshot({
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ]),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValueOnce(new Error("script failed"));

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /script failed/,
    );

    const firstWrite = typeSettingWrites(client).find(([name]) => name === "Order");
    expect(firstWrite?.[1]).toMatchObject({
      disableGqlOperations: { create: true, update: true, delete: true, read: false },
    });
  });

  test("does not write the live read setting back over what an earlier migration in the same run committed", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({ creates: [], updates: ["Order"] });
    const fields = {
      status: { type: "string", required: true },
      first: { type: "string", required: true },
      second: { type: "string", required: true },
    } as const;
    snapshotState.tablesByVersion = {
      0: { Order: snapshotTable("Order", { status: fields.status }) },
      1: {
        Order: snapshotTable(
          "Order",
          { status: fields.status, first: fields.first },
          { gqlOperations: { read: false } },
        ),
      },
      2: {
        Order: snapshotTable("Order", fields, { gqlOperations: { read: false } }),
      },
    };
    const added = (fieldName: "first" | "second") =>
      ({
        kind: "field_added",
        tableName: "Order",
        fieldName,
        after: { type: "string", required: true },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([added("first")], { number: 1 }),
      mkPendingMigration([added("second")], { number: 2 }),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const operations = gqlOperationWrites(client)
      .filter(([name]) => name === "Order")
      .map(([, ops]) => ops);
    expect(operations[0]).toEqual({ create: true, update: true, delete: true, read: false });
    expect(operations.slice(1, -1).length).toBeGreaterThan(1);
    expect(operations.slice(1, -1).at(-1)).toEqual({
      create: true,
      update: true,
      delete: true,
      read: true,
    });
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

  describe("maintenanceMode", () => {
    const orderTable = () => snapshotTable("Order", { status: { type: "string", required: true } });

    function mockAddedOrderMigration() {
      snapshotState.tablesByVersion = { 0: {}, 1: { Order: orderTable() } };
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
    }

    const restricted = {
      publishRecordEvents: false,
      disableGqlOperations: { create: true, update: true, delete: true, read: false },
    };
    const released = { publishRecordEvents: true, disableGqlOperations: undefined };

    test("leaves every write unrestricted when it is false", async () => {
      using stderr = captureStderr();
      const client = createMockClient();
      const planResult = createMockPlanResult({
        creates: ["Order"],
        subscribedTables: ["Order"],
        maintenanceMode: false,
      });
      mockAddedOrderMigration();

      const report = await applyTailorDB(client, planResult, "create-update");

      expect(report).toBeUndefined();
      expect(stderr.output).not.toContain("were in maintenance mode");

      const writes = typeSettingWrites(client).filter(([name]) => name === "Order");
      expect(writes.length).toBeGreaterThan(1);
      for (const [, settings] of writes) {
        expect(settings?.publishRecordEvents).toBe(true);
        expect(settings?.disableGqlOperations).toBeUndefined();
      }
    });

    test.each(["rollback", "restoration", "checkpoint"] as const)(
      "does not report restrictions with maintenance mode off after a %s failure",
      async (failure) => {
        using stderr = captureStderr();
        const client = createMockClient();
        const planResult = createMockPlanResult({
          creates: failure === "rollback" ? ["Order"] : [],
          subscribedTables: ["Order"],
          maintenanceMode: false,
        });
        if (failure === "rollback") {
          mockAddedOrderMigration();
          vi.mocked(client.deleteTailorDBType).mockRejectedValueOnce(new Error("rollback failed"));
        } else {
          snapshotState.tablesByVersion = {
            0: { Order: orderTable() },
            1: { Order: orderTable() },
          };
          vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
            mkPendingMigration([]),
          ]);
        }
        if (failure === "checkpoint") {
          vi.mocked(migrationModule.updateMigrationLabel).mockImplementationOnce(async () => {
            checkpoint.state.number = 2;
            return true;
          });
        } else {
          vi.mocked(migrationModule.executeMigrations).mockRejectedValueOnce(
            new Error("script failed"),
          );
          if (failure === "restoration") {
            vi.mocked(client.updateTailorDBType).mockRejectedValueOnce(new Error("restore failed"));
          }
        }

        const error = await applyTailorDB(client, planResult, "create-update").catch(
          (failure: unknown) => failure,
        );
        expect(error).toBeInstanceOf(Error);
        expect(vi.mocked(migrationModule.executeMigrations)).toHaveBeenCalledWith(
          expect.objectContaining({ maintenanceMode: false }),
          expect.any(Array),
          expect.any(Object),
          undefined,
        );
        const restrictionClaim =
          /Still restricted|keep the restrictions|Tables that stay restricted/;
        expect(stderr.output).not.toMatch(restrictionClaim);
        expect(JSON.stringify(errorToJson(error))).not.toMatch(restrictionClaim);
      },
    );

    test("uses migration maintenance mode when the option is unset", async () => {
      const client = createMockClient();
      const planResult = createMockPlanResult({
        creates: ["Order"],
        subscribedTables: ["Order"],
        maintenanceMode: undefined,
      });
      mockAddedOrderMigration();
      const holdMaintenanceMode = vi.fn();

      await applyTailorDB(client, planResult, "create-update", { holdMaintenanceMode });

      expect(typeSettingWrites(client).find(([name]) => name === "Order")?.[1]).toEqual(
        expect.objectContaining(restricted),
      );
      expect(lastOrderSettings(client)).toEqual(expect.objectContaining(released));
      expect(checkpoint.state.maintenanceModeChanges).toEqual(["m0001", null]);
      expect(holdMaintenanceMode).not.toHaveBeenCalled();
    });

    test("writes a checkpoint table that opts out of publishing while an executor subscribes", async () => {
      const client = createMockClient();
      const planResult = createMockPlanResult({
        creates: ["Order"],
        subscribedTables: ["Order"],
        maintenanceMode: false,
      });
      snapshotState.tablesByVersion = {
        0: {
          Order: snapshotTable(
            "Order",
            { status: { type: "string", required: true } },
            { publishEvents: false },
          ),
        },
        1: { Order: orderTable() },
      };
      vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
        mkPendingMigration([]),
      ]);

      await applyTailorDB(client, planResult, "create-update");

      const flags = publishFlagWrites(client)
        .filter(([name]) => name === "Order")
        .map(([, flag]) => flag);
      expect(flags[0]).toBe(false);
      expect(flags.at(-1)).toBe(true);
    });

    test('"deploy" keeps the namespace restricted until the held release runs', async () => {
      using stderr = captureStderr();
      const client = createMockClient();
      const planResult = createMockPlanResult({
        creates: ["Order"],
        subscribedTables: ["Order"],
        maintenanceMode: "deploy",
      });
      mockAddedOrderMigration();

      const clock = vi.spyOn(performance, "now").mockReturnValue(0);
      try {
        const releases: MaintenanceModeRelease[] = [];
        const report = await applyTailorDB(client, planResult, "create-update", {
          holdMaintenanceMode: (release) => releases.push(release),
        });

        expect(report).toBeUndefined();
        expect(stderr.output).not.toContain("were in maintenance mode");
        expect(lastOrderSettings(client)).toEqual(expect.objectContaining(restricted));
        expect(releases).toHaveLength(1);

        clock.mockReturnValue(10_000);
        vi.mocked(client.setMetadata).mockImplementationOnce(async (request) => {
          clock.mockReturnValue(30_000);
          checkpoint.state.maintenanceMode = request.labels?.["sdk-maintenance-mode"] ?? null;
          return {} as never;
        });
        const releasedReport = await releases[0]?.(client);

        expect(releasedReport?.maintenanceMs).toBe(10_000);
        expect(releasedReport?.phases.remainingDeploy).toBe(10_000);
        expect(stderr.output).toContain("were in maintenance mode");
        expect(lastOrderSettings(client)).toEqual(expect.objectContaining(released));
      } finally {
        clock.mockRestore();
      }
    });

    test.each([
      [
        "advanced",
        (_client: OperatorClient) => {
          checkpoint.state.number = 2;
        },
        /advanced concurrently to 0002/i,
      ],
      [
        "cannot be read",
        (client: OperatorClient) => {
          vi.mocked(client.getMetadata).mockRejectedValueOnce(new Error("ownership read failed"));
        },
        /Could not verify ownership.*ownership read failed/i,
      ],
    ] as const)(
      '"deploy" keeps a namespace restricted when its checkpoint %s while held',
      async (_label, changeCheckpoint, error) => {
        const client = createMockClient();
        const planResult = createMockPlanResult({
          creates: ["Order"],
          subscribedTables: ["Order"],
          maintenanceMode: "deploy",
        });
        mockAddedOrderMigration();

        const releases: MaintenanceModeRelease[] = [];
        await applyTailorDB(client, planResult, "create-update", {
          holdMaintenanceMode: (release) => releases.push(release),
        });
        changeCheckpoint(client);

        await expect(releases[0]?.(client)).rejects.toThrow(error);
        expect(lastOrderSettings(client)).toEqual(expect.objectContaining(restricted));
      },
    );

    test('"migration" records its checkpoint until it lifts maintenance mode', async () => {
      const client = createMockClient();
      const planResult = createMockPlanResult({
        creates: ["Order"],
        subscribedTables: ["Order"],
        maintenanceMode: "migration",
      });
      mockAddedOrderMigration();

      await applyTailorDB(client, planResult, "create-update");

      expect(checkpoint.state.maintenanceModeChanges).toEqual(["m0001", null]);
    });

    test('"deploy" keeps its checkpoint recorded until the held release runs', async () => {
      const client = createMockClient();
      const planResult = createMockPlanResult({
        creates: ["Order"],
        subscribedTables: ["Order"],
        maintenanceMode: "deploy",
      });
      mockAddedOrderMigration();

      const releases: MaintenanceModeRelease[] = [];
      await applyTailorDB(client, planResult, "create-update", {
        holdMaintenanceMode: (release) => releases.push(release),
      });

      expect(checkpoint.state.maintenanceMode).toBe("m0001");

      await releases[0]?.(client);

      expect(checkpoint.state.maintenanceModeChanges).toEqual(["m0001", null]);
    });

    test("records only the last checkpoint of a namespace, together with it", async () => {
      const client = createMockClient();
      const planResult = createMockPlanResult({
        creates: ["Order"],
        subscribedTables: ["Order"],
        maintenanceMode: "migration",
      });
      snapshotState.tablesByVersion = {
        0: { Order: orderTable() },
        1: { Order: orderTable() },
        2: { Order: orderTable() },
      };
      vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
        mkPendingMigration([], { number: 1 }),
        mkPendingMigration([], { number: 2 }),
      ]);

      await applyTailorDB(client, planResult, "create-update");

      expect(
        vi
          .mocked(migrationModule.updateMigrationLabel)
          .mock.calls.map(([, , , number, , recordMaintenanceMode]) => [
            number,
            recordMaintenanceMode,
          ]),
      ).toEqual([
        [1, false],
        [2, true],
      ]);
      expect(checkpoint.state.maintenanceModeChanges).toEqual(["m0002", null]);
    });

    test("releases tables an earlier deploy left in maintenance mode when the next migration fails", async () => {
      const client = createMockClient({
        existingSettings: {
          Order: {
            bulkUpsert: false,
            publishRecordEvents: false,
            disableGqlOperations: { create: true, update: true, delete: true, read: false },
          },
        },
      });
      const planResult = createMockPlanResult({
        creates: [],
        updates: ["Order"],
        subscribedTables: ["Order"],
        maintenanceMode: "migration",
      });
      snapshotState.tablesByVersion = { 0: { Order: orderTable() }, 1: { Order: orderTable() } };
      vi.mocked(migrationModule.detectPendingMigrations).mockImplementation(
        async (_client, _workspaceId, _namespaces, _configPath, _overrides, remoteStates) => {
          remoteStates?.set("test-ns", {
            metadataExists: true,
            number: 0,
            historyId: null,
            historyIdInvalid: false,
            inProgress: null,
            inProgressInvalid: false,
            maintenanceModeCheckpoint: 0,
          });
          return [mkPendingMigration([])];
        },
      );
      checkpoint.state.maintenanceMode = "m0000";
      vi.mocked(migrationModule.executeMigrations).mockRejectedValueOnce(
        new Error("script failed"),
      );

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        /script failed/,
      );

      expect(lastOrderSettings(client)).toEqual(expect.objectContaining(released));
    });

    test("does not record a checkpoint for a migration that failed", async () => {
      const client = createMockClient();
      const planResult = createMockPlanResult({
        creates: ["Order"],
        subscribedTables: ["Order"],
        maintenanceMode: "migration",
      });
      mockAddedOrderMigration();
      vi.mocked(migrationModule.executeMigrations).mockRejectedValueOnce(
        new Error("script failed"),
      );

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        /script failed/,
      );

      expect(checkpoint.state.maintenanceModeChanges).toEqual([]);
    });

    test("keeps an earlier maintenance record when listing tables fails", async () => {
      const client = createMockClient({
        existingSettings: { Order: { ...restricted, bulkUpsert: false } },
      });
      const planResult = createMockPlanResult({
        creates: [],
        updates: ["Order"],
        subscribedTables: ["Order"],
        maintenanceMode: "migration",
      });
      snapshotState.tablesByVersion = { 0: { Order: orderTable() }, 1: { Order: orderTable() } };
      vi.mocked(migrationModule.detectPendingMigrations).mockImplementation(
        async (_client, _workspaceId, _namespaces, _configPath, _overrides, remoteStates) => {
          remoteStates?.set("test-ns", {
            metadataExists: true,
            number: 0,
            historyId: null,
            historyIdInvalid: false,
            inProgress: null,
            inProgressInvalid: false,
            maintenanceModeCheckpoint: 0,
          });
          return [mkPendingMigration([])];
        },
      );
      checkpoint.state.maintenanceMode = "m0000";
      vi.mocked(client.listTailorDBTypes).mockRejectedValueOnce(new Error("table lookup failed"));

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "table lookup failed",
      );

      expect(client.listTailorDBTypes).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "test-workspace", namespaceName: "test-ns" }),
      );
      expect(client.updateTailorDBType).not.toHaveBeenCalled();
      expect(checkpoint.state.number).toBe(0);
      expect(checkpoint.state.maintenanceMode).toBe("m0000");
      expect(checkpoint.state.maintenanceModeChanges).toEqual([]);

      await applyTailorDB(client, planResult, "create-update");

      expect(checkpoint.state.number).toBe(1);
      expect(checkpoint.state.maintenanceMode).toBeNull();
      expect(lastOrderSettings(client)).toEqual(expect.objectContaining(released));
    });

    test("clears a checkpoint an earlier deploy recorded after restoring tables", async () => {
      const client = createMockClient();
      const planResult = createMockPlanResult({
        creates: ["Order"],
        subscribedTables: ["Order"],
        maintenanceMode: "migration",
      });
      mockAddedOrderMigration();
      const pending = await migrationModule.detectPendingMigrations(
        client,
        "test-workspace",
        [],
        "/test/tailor.config.ts",
      );
      vi.mocked(migrationModule.detectPendingMigrations).mockImplementation(
        async (_client, _workspaceId, _namespaces, _configPath, _overrides, remoteStates) => {
          remoteStates?.set("test-ns", {
            metadataExists: true,
            number: 0,
            historyId: null,
            historyIdInvalid: false,
            inProgress: null,
            inProgressInvalid: false,
            maintenanceModeCheckpoint: 0,
          });
          return pending;
        },
      );
      checkpoint.state.maintenanceMode = "m0000";
      vi.mocked(migrationModule.executeMigrations).mockRejectedValueOnce(
        new Error("script failed"),
      );

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        /script failed/,
      );

      expect(checkpoint.state.maintenanceModeChanges).toEqual([null]);
    });

    test.each([
      ['"deploy" without holding', "deploy", false],
      ['"migration" when asked to hold', "migration", true],
    ] as const)("%s releases the namespace before returning", async (_label, mode, hold) => {
      const client = createMockClient();
      const planResult = createMockPlanResult({
        creates: ["Order"],
        subscribedTables: ["Order"],
        maintenanceMode: mode,
      });
      mockAddedOrderMigration();
      const holdMaintenanceMode = vi.fn();

      await applyTailorDB(client, planResult, "create-update", hold ? { holdMaintenanceMode } : {});

      expect(holdMaintenanceMode).not.toHaveBeenCalled();
      expect(lastOrderSettings(client)).toEqual(expect.objectContaining(released));
    });

    test('"deploy" releases the namespace at once when a migration fails', async () => {
      const client = createMockClient({
        existingSettings: { Order: { publishRecordEvents: true } },
      });
      const planResult = createMockPlanResult({
        creates: ["Order"],
        subscribedTables: ["Order"],
        maintenanceMode: "deploy",
      });
      snapshotState.tablesByVersion = { 0: { Order: orderTable() }, 1: { Order: orderTable() } };
      vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mkPendingMigration([{ kind: "table_added", tableName: "Order" } as any]),
      ]);
      vi.mocked(migrationModule.updateMigrationLabel).mockRejectedValueOnce(
        new Error("checkpoint update failed"),
      );

      const holdMaintenanceMode = vi.fn();
      await expect(
        applyTailorDB(client, planResult, "create-update", { holdMaintenanceMode }),
      ).rejects.toThrow(/checkpoint update failed/);

      expect(holdMaintenanceMode).not.toHaveBeenCalled();
      expect(lastOrderSettings(client)).toEqual(expect.objectContaining(released));
    });
  });
});
