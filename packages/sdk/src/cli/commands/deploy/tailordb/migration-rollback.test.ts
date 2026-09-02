/**
 * A failed migration phase must restore the workspace to its prior checkpoint
 * and prior schema whenever the schema operations are reversible.
 */

import { describe, test, expect, vi, aroundEach } from "vitest";
import { logger } from "#/cli/shared/logger";
import { MigrationExecutionInFlightError } from "./migration-workflow";
import { applyTailorDB, captureMigrationFileState } from "./index";
import type { SchemaSnapshot } from "#/cli/commands/tailordb/migrate/snapshot-types";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { Application } from "#/cli/services/application";
import type { TailorDBService } from "#/cli/services/tailordb/service";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";

const remoteCheckpoint = vi.hoisted(() => ({
  number: 0,
  historyId: null as string | null,
}));

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

vi.mock("./migration", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./migration");
  return {
    ...original,
    detectPendingMigrations: vi.fn(),
    executeMigrations: vi.fn(),
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

vi.mock("#/cli/commands/tailordb/migrate/config", () => ({
  getNamespacesWithMigrations: vi.fn().mockReturnValue([
    {
      namespace: "test-ns",
      migrationsDir: "/test/migrations",
    },
  ]),
}));

const snapshotFixtures = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildType = (name: string, pluralForm: string, fields: Record<string, any>): any => ({
    name,
    pluralForm,
    fields,
  });

  // Migration 1 adds a new table (StockReservation) and a `note` field on GoodsReceipt.
  const typesByMigration: Record<number, unknown> = {
    0: {
      GoodsReceipt: buildType("GoodsReceipt", "goodsReceipts", {
        code: { type: "string", required: true },
      }),
    },
    1: {
      GoodsReceipt: buildType("GoodsReceipt", "goodsReceipts", {
        code: { type: "string", required: true },
        note: { type: "string", required: false },
      }),
      StockReservation: buildType("StockReservation", "stockReservations", {
        quantity: { type: "integer", required: true },
      }),
    },
    2: {
      GoodsReceipt: buildType("GoodsReceipt", "goodsReceipts", {
        code: { type: "string", required: true },
        note: { type: "string", required: false },
        extra: { type: "string", required: false },
      }),
      StockReservation: buildType("StockReservation", "stockReservations", {
        quantity: { type: "integer", required: true },
      }),
    },
  };

  return {
    reconstructSnapshotFromMigrations: (migrationsDir: string, maxVersion?: number) => {
      void migrationsDir;
      const number = maxVersion ?? 0;
      const tables = typesByMigration[number];
      if (!tables) {
        throw new Error(`No snapshot fixture configured for migration number: ${number}`);
      }
      return {
        version: 1 as const,
        namespace: "test-ns",
        createdAt: new Date().toISOString(),
        tables,
      };
    },
  };
});

vi.mock("#/cli/commands/tailordb/migrate/snapshot", async (importOriginal) => {
  const original =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    (await importOriginal()) as typeof import("#/cli/commands/tailordb/migrate/snapshot");
  return {
    ...original,
    assertValidMigrationFiles: vi.fn(),
    reconstructSnapshotFromMigrations: vi.fn(snapshotFixtures.reconstructSnapshotFromMigrations),
  };
});

import { reconstructSnapshotFromMigrations } from "#/cli/commands/tailordb/migrate/snapshot";
import * as migrationModule from "./migration";

const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

describe("applyTailorDB: rollback of migration schema after failures", () => {
  function createMockClient() {
    return {
      createTailorDBService: vi.fn().mockResolvedValue({}),
      getMetadata: vi.fn().mockImplementation(async () => ({
        metadata: {
          labels: {
            "sdk-migration": `m${String(remoteCheckpoint.number).padStart(4, "0")}`,
            ...(remoteCheckpoint.historyId && {
              "sdk-migration-history": remoteCheckpoint.historyId,
            }),
          },
        },
      })),
      setMetadata: vi.fn().mockResolvedValue({}),
      listTailorDBTypes: vi.fn().mockResolvedValue({
        tailordbTypes: [
          {
            name: "GoodsReceipt",
            schema: {
              settings: { bulkUpsert: false, publishRecordEvents: false },
            },
          },
        ],
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

  function changeSetGroup(
    title: string,
    entries: { creates?: unknown[]; updates?: unknown[]; deletes?: unknown[] } = {},
  ) {
    const creates = entries.creates ?? [];
    const updates = entries.updates ?? [];
    const deletes = entries.deletes ?? [];
    return {
      creates,
      updates,
      deletes,
      unchanged: [],
      title,
      isEmpty: () => creates.length === 0 && updates.length === 0 && deletes.length === 0,
      lines: () => [],
    };
  }

  function buildPlanResult(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeChanges: { creates?: any[]; updates?: any[]; deletes?: any[] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any {
    const mockService = {
      namespace: "test-ns",
      loadTypes: vi.fn().mockResolvedValue({}),
      types: {},
    } as unknown as TailorDBService;

    return {
      changeSet: {
        service: changeSetGroup("TailorDB Services"),
        type: changeSetGroup("TailorDB tables", typeChanges),
        gqlPermission: changeSetGroup("TailorDB GQL Permissions"),
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
      context: {
        workspaceId: "test-workspace",
        application: {
          name: "test-app",
          tailorDBServices: [mockService],
          authService: {
            config: { name: "auth", machineUsers: { migrator: {} } },
          },
        } as unknown as Application,
        tailorDBInputs: [],
        executorUsedTables: new Set<string>(),
        config: mockConfig,
        noSchemaCheck: true,
        checkpointRepairs: [],
        namespacesWithMigrations: [{ namespace: "test-ns", migrationsDir: "/test/migrations" }],
        migrationFileState: captureMigrationFileState([
          { namespace: "test-ns", migrationsDir: "/test/migrations" },
        ]),
      },
    };
  }

  function setPendingMigrations(migrations: PendingMigration[]): void {
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue(migrations);
  }

  function createMockPlanResult() {
    return buildPlanResult({
      creates: [
        {
          name: "StockReservation",
          request: {
            workspaceId: "test-workspace",
            namespaceName: "test-ns",
            tailordbType: {
              name: "StockReservation",
              schema: {
                fields: [
                  { name: "id", type: "uuid", required: true },
                  { name: "quantity", type: "integer", required: true },
                ],
              },
            },
          },
        },
      ],
    });
  }

  function createUpdatePlanResult() {
    return buildPlanResult({
      updates: [
        {
          name: "GoodsReceipt",
          request: {
            workspaceId: "test-workspace",
            namespaceName: "test-ns",
            tailordbType: {
              name: "GoodsReceipt",
              schema: {
                fields: [
                  { name: "id", type: "uuid", required: true },
                  { name: "code", type: "string", required: true },
                  { name: "note", type: "string", required: false },
                ],
              },
            },
          },
        },
      ],
    });
  }

  function mkAddFieldMigration(
    number: number,
    tableName: string,
    fieldName: string,
  ): PendingMigration {
    return {
      number,
      scriptPath: `/test/migrations/${String(number).padStart(4, "0")}/migrate.ts`,
      diffPath: `/test/migrations/${String(number).padStart(4, "0")}/diff.json`,
      hasScript: true,
      namespace: "test-ns",
      migrationsDir: "/test/migrations",
      diff: {
        version: 1,
        namespace: "test-ns",
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_added",
            tableName,
            fieldName,
            after: { type: "string", required: false },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  function mkAddTypeMigration(number: number, tableName: string): PendingMigration {
    return {
      number,
      scriptPath: `/test/migrations/${String(number).padStart(4, "0")}/migrate.ts`,
      diffPath: `/test/migrations/${String(number).padStart(4, "0")}/diff.json`,
      hasScript: true,
      namespace: "test-ns",
      migrationsDir: "/test/migrations",
      diff: {
        version: 1,
        namespace: "test-ns",
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_added",
            tableName,
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  function mkFieldTypeMigration(number: number, tableNames: string[]): PendingMigration {
    return {
      number,
      scriptPath: `/test/migrations/${String(number).padStart(4, "0")}/migrate.ts`,
      diffPath: `/test/migrations/${String(number).padStart(4, "0")}/diff.json`,
      hasScript: true,
      namespace: "test-ns",
      migrationsDir: "/test/migrations",
      diff: {
        version: 1,
        namespace: "test-ns",
        createdAt: new Date().toISOString(),
        changes: tableNames.map((tableName) => ({
          kind: "field_type_modified" as const,
          tableName,
          fieldName: "value",
          before: { type: "integer" as const, required: false },
          after: { type: "float" as const, required: false },
        })),
        hasBreakingChanges: true,
        breakingChanges: tableNames.map((tableName) => ({
          tableName,
          fieldName: "value",
          reason: "Field type changed from integer to float",
        })),
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: true,
      },
    };
  }

  function mkRemoveTypeMigration(number: number, tableName: string): PendingMigration {
    return {
      number,
      scriptPath: `/test/migrations/${String(number).padStart(4, "0")}/migrate.ts`,
      diffPath: `/test/migrations/${String(number).padStart(4, "0")}/diff.json`,
      hasScript: false,
      namespace: "test-ns",
      migrationsDir: "/test/migrations",
      diff: {
        version: 1,
        namespace: "test-ns",
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_removed",
            tableName,
            before: {
              name: tableName,
              pluralForm: "retiredTypes",
              fields: { value: { type: "string", required: false } },
            },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: true,
        warnings: [{ tableName, reason: "Type removed" }],
        requiresMigrationScript: false,
      },
    };
  }

  function createFieldTypePlanResult(tableNames: string[]) {
    return buildPlanResult({
      updates: tableNames.map((tableName) => ({
        name: tableName,
        request: {
          workspaceId: "test-workspace",
          namespaceName: "test-ns",
          tailordbType: {
            name: tableName,
            schema: { fields: { value: { type: "float", required: false } } },
          },
        },
      })),
    });
  }

  function fieldTypeUpdates(client: OperatorClient, tableName: string): string[] {
    return vi
      .mocked(client.updateTailorDBType)
      .mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call) => (call[0] as any)?.tailordbType?.name === tableName,
      )
      .map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call) => (call[0] as any)?.tailordbType?.schema?.fields?.value?.type,
      );
  }

  function deletedTableNames(client: OperatorClient) {
    return vi.mocked(client.deleteTailorDBType).mock.calls.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c) => (c[0] as any)?.tailordbTypeName,
    );
  }

  async function withOverriddenSnapshot(
    override: (migrationsDir: string, maxVersion?: number) => SchemaSnapshot | null,
    run: () => Promise<void>,
  ) {
    const snap = vi.mocked(reconstructSnapshotFromMigrations);
    type SnapImpl = Parameters<typeof snap.mockImplementation>[0];
    snap.mockImplementation(override as SnapImpl);
    try {
      await run();
    } finally {
      snap.mockImplementation(snapshotFixtures.reconstructSnapshotFromMigrations as SnapImpl);
    }
  }

  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    remoteCheckpoint.number = 0;
    remoteCheckpoint.historyId = null;
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(
      async (_client, _workspaceId, _namespace, number, historyId) => {
        remoteCheckpoint.number = number;
        remoteCheckpoint.historyId = historyId ?? null;
      },
    );
    await runTest();
  });

  test("deletes the type created by the failed migration's Pre-phase and does not advance the checkpoint", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    setPendingMigrations([mkAddTypeMigration(1, "StockReservation")]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = Error: field 'supplierSnapshotName' not found"),
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "supplierSnapshotName",
    );

    // Pre-phase committed the DDL (the new table was created)...
    expect(client.createTailorDBType).toHaveBeenCalledTimes(1);

    // ...so the failed apply must roll it back: StockReservation did not exist at
    // the prior checkpoint, so it is dropped.
    expect(deletedTableNames(client)).toContain("StockReservation");

    // The checkpoint must stay at the prior migration.
    expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
  });

  test("leaves the pre-phase schema in place when an earlier run's script is still executing", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    setPendingMigrations([mkAddTypeMigration(1, "StockReservation")]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new MigrationExecutionInFlightError("testdb", "still running from an earlier run"),
    );
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "still running from an earlier run",
    );

    // The running script depends on this schema and on the tables staying
    // restricted; undoing either would break the execution the user was just
    // told to wait for.
    expect(deletedTableNames(client)).not.toContain("StockReservation");
    expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Leaving TailorDB tables in namespace 'testdb' restricted"),
    );
    warn.mockRestore();
  });

  test("deletes the new table's GQL permission before dropping the table on rollback", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();
    // The Pre-phase also created a GQL permission for the new table.
    planResult.changeSet.gqlPermission.creates = [
      {
        name: "StockReservation",
        request: {
          workspaceId: "test-workspace",
          namespaceName: "test-ns",
          tableName: "StockReservation",
          permission: {},
        },
      },
    ];

    setPendingMigrations([mkAddTypeMigration(1, "StockReservation")]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = migration failed"),
    );

    const order: string[] = [];
    vi.mocked(client.deleteTailorDBGQLPermission).mockImplementation((req: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      order.push(`perm:${(req as any)?.typeName}`);
      return Promise.resolve({}) as never;
    });
    vi.mocked(client.deleteTailorDBType).mockImplementation((req: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      order.push(`type:${(req as any)?.tailordbTypeName}`);
      return Promise.resolve({}) as never;
    });

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "migration failed",
    );

    // The platform does not cascade, so the permission must be deleted first.
    expect(order).toEqual(["perm:StockReservation", "type:StockReservation"]);
    expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
  });

  test("does not create or roll back a permission table absent from the migration snapshot", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();
    planResult.changeSet.type.creates.push({
      name: "LeakedType",
      request: {
        workspaceId: "test-workspace",
        namespaceName: "test-ns",
        tailordbType: { name: "LeakedType", schema: { fields: [] } },
      },
    });
    planResult.changeSet.gqlPermission.creates = [
      {
        name: "LeakedType",
        request: {
          workspaceId: "test-workspace",
          namespaceName: "test-ns",
          tableName: "LeakedType",
          permission: {},
        },
      },
    ];

    setPendingMigrations([mkAddTypeMigration(1, "StockReservation")]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = migration failed"),
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "migration failed",
    );

    const deletedNames = deletedTableNames(client);
    expect(deletedNames).toContain("StockReservation");
    expect(deletedNames).not.toContain("LeakedType");
  });

  test("does not roll back a drifted type the pre-phase never touched", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    setPendingMigrations([mkAddTypeMigration(1, "StockReservation")]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = migration failed"),
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "migration failed",
    );

    // GoodsReceipt pre-exists at the prior checkpoint and was not touched by this
    // run, so rollback must neither update nor delete it.
    const touched = [
      ...vi.mocked(client.deleteTailorDBType).mock.calls,
      ...vi.mocked(client.updateTailorDBType).mock.calls,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ].map((c) => (c[0] as any)?.tailordbTypeName ?? (c[0] as any)?.tailordbType?.name);
    expect(touched).not.toContain("GoodsReceipt");
  });

  test("restores a pre-existing type to its prior-checkpoint schema when migrate.ts fails", async () => {
    const client = createMockClient();
    const planResult = createUpdatePlanResult();

    setPendingMigrations([mkAddFieldMigration(1, "GoodsReceipt", "note")]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = migration failed"),
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "migration failed",
    );

    const updateCalls = vi.mocked(client.updateTailorDBType).mock.calls;
    // The last update for GoodsReceipt is the rollback to its prior schema.
    const goodsReceiptUpdates = updateCalls.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c) => (c[0] as any)?.tailordbType?.name === "GoodsReceipt",
    );
    expect(goodsReceiptUpdates.length).toBeGreaterThanOrEqual(1);

    const lastUpdate = goodsReceiptUpdates.at(-1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const restoredFields = (lastUpdate![0] as any)?.tailordbType?.schema?.fields ?? {};
    // The prior checkpoint did not have `note`, so it must be gone after rollback.
    expect(Object.keys(restoredFields)).toContain("code");
    expect(Object.keys(restoredFields)).not.toContain("note");

    // A pre-existing type must not be deleted by the rollback.
    expect(client.deleteTailorDBType).not.toHaveBeenCalled();
    expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
  });

  test("in a multi-migration run, rolls back the failed migration to snapshot[N-1] and keeps the prior one committed", async () => {
    const client = createMockClient();
    const planResult = createUpdatePlanResult();

    setPendingMigrations([
      mkAddFieldMigration(1, "GoodsReceipt", "note"),
      mkAddFieldMigration(2, "GoodsReceipt", "extra"),
    ]);
    // Migration 1 succeeds, migration 2's script fails.
    vi.mocked(migrationModule.executeMigrations).mockImplementation(
      (_ctx: unknown, migrations: PendingMigration[]) =>
        migrations.some((m) => m.number === 2)
          ? Promise.reject(new Error("migration 2 failed"))
          : Promise.resolve(undefined),
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "migration 2 failed",
    );

    // Migration 1 committed (its checkpoint advanced); migration 2 did not.
    const labelNumbers = vi
      .mocked(migrationModule.updateMigrationLabel)
      .mock.calls.map((c) => c[3]);
    expect(labelNumbers).toEqual([1]);

    // Rollback restored GoodsReceipt to snapshot[1] (has `note`, not `extra`) —
    // proving it targeted N-1, not the baseline.
    const lastUpdate = vi
      .mocked(client.updateTailorDBType)
      .mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c) => (c[0] as any)?.tailordbType?.name === "GoodsReceipt",
      )
      .at(-1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const restoredFields = Object.keys((lastUpdate![0] as any)?.tailordbType?.schema?.fields ?? {});
    expect(restoredFields).toContain("note");
    expect(restoredFields).not.toContain("extra");
  });

  test("rolls back only types touched by the failed migration", async () => {
    const table = (name: string, fields: SchemaSnapshot["tables"][string]["fields"]) => ({
      name,
      pluralForm: `${name}s`,
      fields,
    });
    const snapshots: Record<number, SchemaSnapshot> = {
      0: {
        version: 1,
        namespace: "test-ns",
        createdAt: new Date().toISOString(),
        tables: {
          Audit: table("Audit", { message: { type: "string", required: true } }),
          Existing: table("Existing", { code: { type: "string", required: true } }),
        },
      },
      1: {
        version: 1,
        namespace: "test-ns",
        createdAt: new Date().toISOString(),
        tables: {
          Audit: table("Audit", { message: { type: "string", required: true } }),
          Existing: table("Existing", { code: { type: "string", required: true } }),
          New1: table("New1", { value: { type: "string", required: false } }),
        },
      },
      2: {
        version: 1,
        namespace: "test-ns",
        createdAt: new Date().toISOString(),
        tables: {
          Audit: table("Audit", { message: { type: "string", required: true } }),
          Existing: table("Existing", {
            code: { type: "string", required: true },
            extra: { type: "string", required: false },
          }),
          New1: table("New1", { value: { type: "string", required: false } }),
          New2: table("New2", { value: { type: "string", required: false } }),
        },
      },
    };
    const client = createMockClient();
    const planResult = buildPlanResult({
      creates: ["Audit", "Existing", "New1", "New2"].map((name) => ({
        name,
        request: {
          workspaceId: "test-workspace",
          namespaceName: "test-ns",
          tailordbType: { name, schema: { fields: [] } },
        },
      })),
    });
    const migration2 = mkAddTypeMigration(2, "New2");
    migration2.diff.changes.push({
      kind: "field_added",
      tableName: "Existing",
      fieldName: "extra",
      after: { type: "string", required: false },
    });
    setPendingMigrations([mkAddTypeMigration(1, "New1"), migration2]);
    vi.mocked(migrationModule.executeMigrations).mockImplementation(
      (_ctx: unknown, migrations: PendingMigration[]) =>
        migrations.some((migration) => migration.number === 2)
          ? Promise.reject(new Error("migration 2 failed"))
          : Promise.resolve(undefined),
    );

    await withOverriddenSnapshot(
      (_migrationsDir, maxVersion) => snapshots[maxVersion ?? 0]!,
      async () => {
        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "migration 2 failed",
        );
      },
    );

    const createdTypeNames = vi
      .mocked(client.createTailorDBType)
      .mock.calls.map((call) => call[0].tailordbType?.name);
    expect(createdTypeNames).toContain("Audit");
    expect(createdTypeNames).toContain("New1");
    expect(
      vi.mocked(migrationModule.updateMigrationLabel).mock.calls.map((call) => call[3]),
    ).toEqual([1]);

    const updatedTypeNames = vi
      .mocked(client.updateTailorDBType)
      .mock.calls.map((call) => call[0].tailordbType?.name);
    expect(updatedTypeNames.filter((name) => name === "Existing")).toHaveLength(2);
    expect(updatedTypeNames).not.toContain("Audit");
    expect(updatedTypeNames).not.toContain("New1");
    expect(deletedTableNames(client)).toEqual(["New2"]);

    const restoredExisting = vi
      .mocked(client.updateTailorDBType)
      .mock.calls.filter((call) => call[0].tailordbType?.name === "Existing")
      .at(-1)?.[0].tailordbType;
    expect(Object.keys(restoredExisting?.schema?.fields ?? {})).toContain("code");
    expect(Object.keys(restoredExisting?.schema?.fields ?? {})).not.toContain("extra");
  });

  test("restores every updated type when the post-phase fails partway through", async () => {
    const tableNames = ["Alpha", "Beta"];
    const snapshots = (number: number) => ({
      version: 1 as const,
      namespace: "test-ns",
      createdAt: new Date().toISOString(),
      tables: Object.fromEntries(
        tableNames.map((tableName) => [
          tableName,
          {
            name: tableName,
            pluralForm: `${tableName}s`,
            fields: {
              value: { type: number === 0 ? "integer" : "float", required: false },
            },
          },
        ]),
      ),
    });
    const client = createMockClient();
    const planResult = createFieldTypePlanResult(tableNames);
    let rejected = false;
    vi.mocked(client.updateTailorDBType).mockImplementation((request) => {
      const tableName = request.tailordbType?.name;
      const fieldType = request.tailordbType?.schema?.fields?.value?.type;
      if (!rejected && tableName === "Beta" && fieldType === "float") {
        rejected = true;
        return Promise.reject(new Error("post-phase update failed"));
      }
      return Promise.resolve({}) as never;
    });
    setPendingMigrations([mkFieldTypeMigration(1, tableNames)]);

    await withOverriddenSnapshot(
      (_migrationsDir, maxVersion) => snapshots(maxVersion ?? 0),
      async () => {
        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "post-phase update failed",
        );
      },
    );

    expect(fieldTypeUpdates(client, "Alpha").at(-1)).toBe("integer");
    expect(fieldTypeUpdates(client, "Beta").at(-1)).toBe("integer");
    expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
  });

  test("keeps the target schema when the failed checkpoint update reads back an older value", async () => {
    const tableNames = ["GoodsReceipt"];
    const snapshots = (number: number) => ({
      version: 1 as const,
      namespace: "test-ns",
      createdAt: new Date().toISOString(),
      tables: {
        GoodsReceipt: {
          name: "GoodsReceipt",
          pluralForm: "goodsReceipts",
          fields: {
            value: { type: number === 0 ? "integer" : "float", required: false },
          },
        },
      },
    });
    const client = createMockClient();
    const planResult = createFieldTypePlanResult(tableNames);
    setPendingMigrations([mkFieldTypeMigration(1, tableNames)]);
    vi.mocked(migrationModule.updateMigrationLabel).mockRejectedValueOnce(
      new Error("checkpoint update failed"),
    );

    await withOverriddenSnapshot(
      (_migrationsDir, maxVersion) => snapshots(maxVersion ?? 0),
      async () => {
        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "checkpoint update failed",
        );
      },
    );

    expect(fieldTypeUpdates(client, "GoodsReceipt").at(-1)).toBe("float");
  });

  test("keeps the target schema when checkpoint read-back confirms a lost response", async () => {
    const tableNames = ["GoodsReceipt"];
    const snapshots = (number: number) => ({
      version: 1 as const,
      namespace: "test-ns",
      createdAt: new Date().toISOString(),
      tables: {
        GoodsReceipt: {
          name: "GoodsReceipt",
          pluralForm: "goodsReceipts",
          fields: {
            value: { type: number === 0 ? "integer" : "float", required: false },
          },
        },
      },
    });
    const client = createMockClient();
    const planResult = createFieldTypePlanResult(tableNames);
    setPendingMigrations([mkFieldTypeMigration(1, tableNames)]);
    vi.mocked(migrationModule.updateMigrationLabel).mockRejectedValueOnce(
      new Error("checkpoint response lost"),
    );
    vi.mocked(client.getMetadata).mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0001" } },
    } as never);

    await withOverriddenSnapshot(
      (_migrationsDir, maxVersion) => snapshots(maxVersion ?? 0),
      async () => {
        await expect(applyTailorDB(client, planResult, "create-update")).resolves.toBeUndefined();
      },
    );

    expect(fieldTypeUpdates(client, "GoodsReceipt").at(-1)).toBe("float");
  });

  test("does not roll back when checkpoint read-back has advanced past this migration", async () => {
    const tableNames = ["GoodsReceipt"];
    const snapshots = (number: number) => ({
      version: 1 as const,
      namespace: "test-ns",
      createdAt: new Date().toISOString(),
      tables: {
        GoodsReceipt: {
          name: "GoodsReceipt",
          pluralForm: "goodsReceipts",
          fields: {
            value: { type: number === 0 ? "integer" : "float", required: false },
          },
        },
      },
    });
    const client = createMockClient();
    const planResult = createFieldTypePlanResult(tableNames);
    planResult.context.tailorDBInputs = [
      {
        namespace: "test-ns",
        config: {},
        types: snapshots(1).tables,
      },
    ];
    setPendingMigrations([mkFieldTypeMigration(1, tableNames)]);
    vi.mocked(client.getMetadata).mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0002" } },
    } as never);
    let writesAtCheckpointAttempt = 0;
    vi.mocked(migrationModule.updateMigrationLabel)
      .mockReset()
      .mockImplementationOnce(async () => {
        writesAtCheckpointAttempt = vi.mocked(client.updateTailorDBType).mock.calls.length;
        throw new Error("checkpoint response lost");
      });

    await withOverriddenSnapshot(
      (_migrationsDir, maxVersion) => snapshots(maxVersion ?? 0),
      async () => {
        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          /advanced concurrently/,
        );
      },
    );

    expect(fieldTypeUpdates(client, "GoodsReceipt").at(-1)).toBe("float");
    expect(client.updateTailorDBType).toHaveBeenCalledTimes(writesAtCheckpointAttempt);
  });

  test("advances the checkpoint before deleting a removed table", async () => {
    const tableName = "RetiredType";
    const snapshots = (number: number): SchemaSnapshot => ({
      version: 1 as const,
      namespace: "test-ns",
      createdAt: new Date().toISOString(),
      tables:
        number === 0
          ? {
              [tableName]: {
                name: tableName,
                pluralForm: "retiredTypes",
                fields: { value: { type: "string" as const, required: false } },
              },
            }
          : {},
    });
    const planResult = buildPlanResult({
      deletes: [
        {
          name: tableName,
          request: {
            workspaceId: "test-workspace",
            namespaceName: "test-ns",
            tailordbTypeName: tableName,
          },
        },
      ],
    });
    const client = createMockClient();
    const order: string[] = [];
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(
      async (_client, _workspaceId, _namespace, number, historyId) => {
        remoteCheckpoint.number = number;
        remoteCheckpoint.historyId = historyId ?? null;
        order.push("checkpoint");
      },
    );
    vi.mocked(client.deleteTailorDBType).mockImplementation(async () => {
      order.push("delete");
      return {} as never;
    });
    setPendingMigrations([mkRemoveTypeMigration(1, tableName)]);

    await withOverriddenSnapshot(
      (_migrationsDir, maxVersion) => snapshots(maxVersion ?? 0),
      async () => {
        await applyTailorDB(client, planResult, "create-update");
      },
    );

    expect(order).toEqual(["checkpoint", "delete"]);
  });

  test("rolls back when the pre-phase itself fails (createTailorDBType rejects)", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();
    vi.mocked(client.createTailorDBType).mockRejectedValue(new Error("pre-phase create failed"));

    setPendingMigrations([mkAddTypeMigration(1, "StockReservation")]);

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "pre-phase create failed",
    );

    // The script never ran, the type the pre-phase tried to create is rolled
    // back, and the checkpoint is untouched.
    expect(migrationModule.executeMigrations).not.toHaveBeenCalled();
    expect(deletedTableNames(client)).toContain("StockReservation");
    expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
  });

  test("surfaces the original migration error even when the rollback itself fails", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    setPendingMigrations([mkAddTypeMigration(1, "StockReservation")]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = original migration failure"),
    );

    // Let preflight and the pre-loop baseline materialization capture the
    // baseline, then make rollback's third baseline reconstruction throw
    // (e.g. files disappeared after the migration loop started).
    let baselineReads = 0;
    await withOverriddenSnapshot(
      (migrationsDir, maxVersion) => {
        if ((maxVersion ?? 0) === 0 && ++baselineReads > 2) {
          throw new Error("rollback snapshot reconstruction failed");
        }
        return snapshotFixtures.reconstructSnapshotFromMigrations(
          migrationsDir,
          maxVersion,
        ) as SchemaSnapshot;
      },
      async () => {
        // The original failure must surface, not the rollback error.
        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "original migration failure",
        );
        expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
      },
    );
  });

  test("does not delete any type when the prior snapshot cannot be reconstructed", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    setPendingMigrations([mkAddTypeMigration(1, "StockReservation")]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = original migration failure"),
    );

    // Prior snapshot becomes unavailable at rollback time: new and
    // pre-existing tables are then indistinguishable, so nothing must be
    // deleted.
    let baselineReads = 0;
    await withOverriddenSnapshot(
      (migrationsDir, maxVersion) =>
        (maxVersion ?? 0) === 0 && ++baselineReads > 2
          ? null
          : (snapshotFixtures.reconstructSnapshotFromMigrations(
              migrationsDir,
              maxVersion,
            ) as SchemaSnapshot),
      async () => {
        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "original migration failure",
        );
        expect(client.deleteTailorDBType).not.toHaveBeenCalled();
        expect(client.updateTailorDBType).not.toHaveBeenCalled();
      },
    );
  });
});
