/**
 * A failed migration phase must restore the workspace to its prior checkpoint
 * and prior schema whenever the schema operations are reversible.
 */

import { Code, ConnectError } from "@connectrpc/connect";
import { describe, test, expect, vi, aroundEach } from "vitest";
import { getErrorDiagnostics, withErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { errorToJson } from "#/cli/shared/error-json";
import { logger } from "#/cli/shared/logger";
import { warnTablesLeftRestricted } from "./migration-execution";
import { applyTailorDB, captureMigrationFileState, preflightTailorDB } from "./index";
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
  const original = await importOriginal<typeof import("../label")>();
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
  const original = await importOriginal<typeof import("../change-set")>();
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
  const original = await importOriginal<typeof import("./migration")>();
  return {
    ...original,
    detectPendingMigrations: vi.fn(),
    executeMigrations: vi.fn(),
    clearMigrationInProgress: vi.fn(original.clearMigrationInProgress),
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

vi.mock("./migration-workflow", async (importOriginal) => ({
  ...(await importOriginal()),
  removeMigrationWorkflowResources: vi.fn().mockResolvedValue(undefined),
  assertSkippableSteps: vi.fn().mockResolvedValue(undefined),
}));

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
    latestMigrationNumber: Math.max(...Object.keys(typesByMigration).map(Number)),
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
    await importOriginal<typeof import("#/cli/commands/tailordb/migrate/snapshot")>();
  return {
    ...original,
    assertValidMigrationFiles: vi.fn(),
    getLatestMigrationNumber: vi.fn(() => snapshotFixtures.latestMigrationNumber),
    reconstructSnapshotFromMigrations: vi.fn(snapshotFixtures.reconstructSnapshotFromMigrations),
  };
});

import { reconstructSnapshotFromMigrations } from "#/cli/commands/tailordb/migrate/snapshot";
import { protoGqlPermission } from "#/cli/commands/tailordb/migrate/snapshot-manifest";
import { requiredFieldNullValuesError } from "#/cli/commands/tailordb/migrate/test-helpers/platform-errors";
import { CLIError } from "#/cli/shared/errors";
import { tailorDBPlanResultContext } from "../test-helpers/plan-results";
import * as migrationModule from "./migration";
import { MaintenanceTimeline, ScriptRunTimer } from "./migration-timing";
import { assertSkippableSteps, removeMigrationWorkflowResources } from "./migration-workflow";
import {
  createMockClient as createBaseMockClient,
  mockPendingMigrations,
} from "./test-helpers/migration-apply";
import type { RemoteMigrationState } from "#/cli/commands/tailordb/migrate/remote-state";
import type { MigrationScriptForm } from "#/cli/commands/tailordb/migrate/script-form";
import type { SnapshotGqlPermission } from "#/cli/commands/tailordb/migrate/snapshot";

const mockConfig = {
  path: "/test/tailor.config.ts",
  maintenanceMode: "migration",
} as LoadedConfig;

describe("applyTailorDB: rollback of migration schema after failures", () => {
  type MockClient = ReturnType<typeof createMockClient>;

  function createMockClient() {
    return createBaseMockClient({
      getMetadata: async () => ({
        metadata: {
          labels: {
            "sdk-migration": `m${String(remoteCheckpoint.number).padStart(4, "0")}`,
            ...(remoteCheckpoint.historyId && {
              "sdk-migration-history": remoteCheckpoint.historyId,
            }),
          },
        },
      }),
      listTailorDBTypes: {
        tailordbTypes: [
          {
            name: "GoodsReceipt",
            schema: {
              settings: { bulkUpsert: false, publishRecordEvents: false },
            },
          },
        ],
      },
    });
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
      context: tailorDBPlanResultContext({
        workspaceId: "test-workspace",
        application: {
          name: "test-app",
          tailorDBServices: [mockService],
          authServices: [
            {
              config: { name: "auth", machineUsers: { migrator: {} } },
            },
          ],
        } as unknown as Application,
        config: mockConfig,
        noSchemaCheck: true,
        namespacesWithMigrations: [{ namespace: "test-ns", migrationsDir: "/test/migrations" }],
        migrationFileState: captureMigrationFileState([
          { namespace: "test-ns", migrationsDir: "/test/migrations" },
        ]),
      }),
    };
  }

  function setPendingMigrations(migrations: PendingMigration[]) {
    return mockPendingMigrations(migrations, () => ({ ...remoteCheckpoint }));
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
      scriptForm: { kind: "main" },
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
      scriptForm: { kind: "main" },
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
      scriptForm: { kind: "main" },
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
      scriptForm: null,
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

  function fieldTypeUpdates(client: MockClient, tableName: string) {
    return client.updateTailorDBType.mock.calls
      .filter((call) => call[0].tailordbType?.name === tableName)
      .map((call) => call[0].tailordbType?.schema?.fields?.value?.type);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function withRestorableGoodsReceipt(plan = createMockPlanResult()): any {
    const planResult = plan;
    planResult.context.tailorDBInputs = [{ namespace: "test-ns", config: {}, types: {} }];
    return planResult;
  }

  function deletedTableNames(client: MockClient) {
    return client.deleteTailorDBType.mock.calls.map((c) => c[0].tailordbTypeName);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function withInputs(planResult: any) {
    planResult.context.tailorDBInputs = [
      {
        namespace: "test-ns",
        config: {},
        types: snapshotFixtures.reconstructSnapshotFromMigrations("/test/migrations", 1).tables,
      },
    ];
    return planResult;
  }

  function failPostPhase(
    client: MockClient,
    failure: Error = new Error("post-phase constraint violation"),
  ): unknown[] {
    const goodsReceiptWrites: unknown[] = [];
    client.updateTailorDBType.mockImplementation(async (request) => {
      if (request.tailordbType?.name !== "GoodsReceipt") return {};
      goodsReceiptWrites.push(structuredClone(request));
      // Restriction, Pre-phase, then the Post-phase write that fails.
      if (goodsReceiptWrites.length === 3) throw failure;
      return {};
    });
    return goodsReceiptWrites;
  }

  function lastGoodsReceiptSettings(client: MockClient) {
    const writes = client.updateTailorDBType.mock.calls.filter(
      (call) => call[0].tailordbType?.name === "GoodsReceipt",
    );
    return writes.at(-1)?.[0].tailordbType?.schema?.settings;
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
    remoteCheckpoint.number = 0;
    remoteCheckpoint.historyId = null;
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(
      async (_client, _workspaceId, _namespace, number, historyId) => {
        remoteCheckpoint.number = number;
        remoteCheckpoint.historyId = historyId ?? null;
        return true;
      },
    );
    await runTest();
  });

  test("deletes the type created by the failed migration's Pre-phase and does not advance the checkpoint", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    planResult.context.pendingMigrations = setPendingMigrations([
      mkAddTypeMigration(1, "StockReservation"),
    ]);
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

  test("keeps the Pre-phase schema and the restrictions when the migration's outcome is unknown", async () => {
    const client = createMockClient();
    const planResult = withInputs(createMockPlanResult());

    planResult.context.pendingMigrations = setPendingMigrations([
      mkAddTypeMigration(1, "StockReservation"),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      CLIError({
        code: "MIGRATION_OUTCOME_UNKNOWN",
        message: "Could not confirm whether migration test-ns/0001 started: [unavailable] lost",
      }),
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toMatchObject({
      code: "MIGRATION_OUTCOME_UNKNOWN",
    });

    expect(client.createTailorDBType).toHaveBeenCalledTimes(1);
    expect(deletedTableNames(client)).not.toContain("StockReservation");
    expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
    expect(lastGoodsReceiptSettings(client)?.disableGqlOperations).toEqual({
      create: true,
      update: true,
      delete: true,
      read: false,
    });
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

    planResult.context.pendingMigrations = setPendingMigrations([
      mkAddTypeMigration(1, "StockReservation"),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = migration failed"),
    );

    const order: string[] = [];
    client.deleteTailorDBGQLPermission.mockImplementation((request) => {
      order.push(`perm:${request.typeName}`);
      return Promise.resolve({});
    });
    client.deleteTailorDBType.mockImplementation((request) => {
      order.push(`type:${request.tailordbTypeName}`);
      return Promise.resolve({});
    });

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "migration failed",
    );

    // The platform does not cascade, so the permission must be deleted first.
    expect(order).toEqual(["perm:StockReservation", "type:StockReservation"]);
    expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
  });

  describe("GQL permissions of an existing table", () => {
    const beforePermission = { policies: [{ description: "before" }] };
    const afterPermission = { policies: [{ description: "after" }] };

    function planWithPermission(kind: "update" | "create") {
      const planResult = createUpdatePlanResult();
      const request = {
        workspaceId: "test-workspace",
        namespaceName: "test-ns",
        typeName: "GoodsReceipt",
        permission: afterPermission,
      };
      if (kind === "update") {
        planResult.changeSet.gqlPermission.updates = [
          { name: "GoodsReceipt", request, previousPermission: beforePermission },
        ];
      } else {
        planResult.changeSet.gqlPermission.creates = [{ name: "GoodsReceipt", request }];
      }
      return planResult;
    }

    function failMigration(planResult: ReturnType<typeof planWithPermission>): void {
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddFieldMigration(1, "GoodsReceipt", "note"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
        new Error("rpc error: code = Aborted desc = migration failed"),
      );
    }

    test("restores the permission the Pre-phase replaced", async () => {
      const client = createMockClient();
      const planResult = planWithPermission("update");
      failMigration(planResult);

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "migration failed",
      );

      expect(client.updateTailorDBGQLPermission.mock.calls.map(([req]) => req)).toEqual([
        expect.objectContaining({ typeName: "GoodsReceipt", permission: afterPermission }),
        expect.objectContaining({ typeName: "GoodsReceipt", permission: beforePermission }),
      ]);
    });

    test("deletes a permission the Pre-phase added to a table that had none", async () => {
      const client = createMockClient();
      const planResult = planWithPermission("create");
      failMigration(planResult);

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "migration failed",
      );

      expect(client.deleteTailorDBGQLPermission).toHaveBeenCalledWith(
        expect.objectContaining({ namespaceName: "test-ns", typeName: "GoodsReceipt" }),
      );
    });
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

    planResult.context.pendingMigrations = setPendingMigrations([
      mkAddTypeMigration(1, "StockReservation"),
    ]);
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

    planResult.context.pendingMigrations = setPendingMigrations([
      mkAddTypeMigration(1, "StockReservation"),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = migration failed"),
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "migration failed",
    );

    // GoodsReceipt pre-exists at the prior checkpoint and was not touched by this
    // run, so rollback must neither update nor delete it.
    const touched = [
      ...client.deleteTailorDBType.mock.calls.map(([request]) => request.tailordbTypeName),
      ...client.updateTailorDBType.mock.calls.map(([request]) => request.tailordbType?.name),
    ];
    expect(touched).not.toContain("GoodsReceipt");
  });

  test("restores a pre-existing type to its prior-checkpoint schema when migrate.ts fails", async () => {
    const client = createMockClient();
    const planResult = createUpdatePlanResult();

    planResult.context.pendingMigrations = setPendingMigrations([
      mkAddFieldMigration(1, "GoodsReceipt", "note"),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = migration failed"),
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "migration failed",
    );

    const updateCalls = client.updateTailorDBType.mock.calls;
    // The last update for GoodsReceipt is the rollback to its prior schema.
    const goodsReceiptUpdates = updateCalls.filter(
      (c) => c[0].tailordbType?.name === "GoodsReceipt",
    );
    expect(goodsReceiptUpdates.length).toBeGreaterThanOrEqual(1);

    const lastUpdate = goodsReceiptUpdates.at(-1);
    const restoredFields = lastUpdate![0].tailordbType?.schema?.fields ?? {};
    // The prior checkpoint did not have `note`, so it must be gone after rollback.
    expect(Object.keys(restoredFields)).toContain("code");
    expect(Object.keys(restoredFields)).not.toContain("note");

    // A pre-existing type must not be deleted by the rollback.
    expect(client.deleteTailorDBType).not.toHaveBeenCalled();
    expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
  });

  test("reports how long the migrating namespace stayed in maintenance mode", async () => {
    const client = createMockClient();
    const planResult = createUpdatePlanResult();
    planResult.context.pendingMigrations = setPendingMigrations([
      mkAddFieldMigration(1, "GoodsReceipt", "note"),
    ]);
    let clock = 0;
    vi.mocked(migrationModule.executeMigrations).mockImplementationOnce(
      async (_ctx, migrations, _checkpoints, _inProgress, timeline) => {
        const run = new ScriptRunTimer("test-ns", migrations[0]!.number, clock);
        clock += 2_000;
        run.waiting(clock);
        clock += 60_000;
        run.running(clock);
        clock += 9_000;
        run.finished(clock, true);
        clock += 1_000;
        timeline?.recordScript(run, clock);
      },
    );
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(
      async (_client, _workspaceId, _namespace, number, historyId) => {
        clock += 4_000;
        remoteCheckpoint.number = number;
        remoteCheckpoint.historyId = historyId ?? null;
        return true;
      },
    );
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});

    try {
      const report = await applyTailorDB(client, planResult, "create-update");

      expect(vi.mocked(migrationModule.executeMigrations).mock.calls[0]![4]).toBeInstanceOf(
        MaintenanceTimeline,
      );
      expect(report).toEqual({
        namespaces: ["test-ns"],
        maintenanceMs: 76_000,
        phases: {
          restrict: 0,
          preMigration: 0,
          jobSetup: 2_000,
          waitingToStart: 60_000,
          running: 9_000,
          waitingOrRunning: 0,
          jobCleanup: 1_000,
          postMigration: 4_000,
          remainingDeploy: 0,
          restore: 0,
        },
        migrations: [
          {
            namespace: "test-ns",
            migrationNumber: 1,
            startObserved: true,
            waitingToStartMs: 60_000,
            runningMs: 9_000,
            waitingOrRunningMs: 0,
          },
        ],
      });
      expect(info).toHaveBeenCalledWith(
        "Tables of namespace test-ns were in maintenance mode for 1m16s (job setup 2.0s, " +
          "waiting to start 1m00s, running 9.0s, job cleanup 1.0s, post-migration 4.0s).",
      );
    } finally {
      now.mockRestore();
      info.mockRestore();
    }
  });

  test("reports no maintenance window when the migration fails", async () => {
    const client = createMockClient();
    const planResult = createUpdatePlanResult();
    planResult.context.pendingMigrations = setPendingMigrations([
      mkAddFieldMigration(1, "GoodsReceipt", "note"),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(new Error("script failed"));
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});

    try {
      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "script failed",
      );

      expect(info).not.toHaveBeenCalledWith(expect.stringContaining("maintenance mode for"));
    } finally {
      info.mockRestore();
    }
  });

  test("reports the maintenance window when a change applied after it fails", async () => {
    const client = createMockClient();
    const planResult = createUpdatePlanResult();
    planResult.changeSet.type.deletes.push({
      name: "Legacy",
      request: {
        workspaceId: "test-workspace",
        namespaceName: "other-ns",
        tailordbTypeName: "Legacy",
      },
    });
    client.deleteTailorDBType.mockRejectedValue(new Error("delete failed"));
    planResult.context.pendingMigrations = setPendingMigrations([
      mkAddFieldMigration(1, "GoodsReceipt", "note"),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});

    try {
      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "delete failed",
      );

      expect(info).toHaveBeenCalledWith(
        expect.stringMatching(/^Tables of namespace test-ns were in maintenance mode for /),
      );
    } finally {
      info.mockRestore();
    }
  });

  test("in a multi-migration run, rolls back the failed migration to snapshot[N-1] and keeps the prior one committed", async () => {
    const client = createMockClient();
    const planResult = createUpdatePlanResult();

    planResult.context.pendingMigrations = setPendingMigrations([
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
    const lastUpdate = client.updateTailorDBType.mock.calls
      .filter((c) => c[0].tailordbType?.name === "GoodsReceipt")
      .at(-1);
    const restoredFields = Object.keys(lastUpdate![0].tailordbType?.schema?.fields ?? {});
    expect(restoredFields).toContain("note");
    expect(restoredFields).not.toContain("extra");
  });

  test("records the maintenance mode after the first checkpoint of a multi-migration run that stops at the second migration", async () => {
    const client = createMockClient();
    const planResult = createUpdatePlanResult();
    planResult.context.pendingMigrations = setPendingMigrations([
      mkAddFieldMigration(1, "GoodsReceipt", "note"),
      mkAddFieldMigration(2, "GoodsReceipt", "extra"),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockImplementation(
      (_ctx: unknown, migrations: PendingMigration[]) =>
        migrations.some((m) => m.number === 2)
          ? Promise.reject(new Error("migration 2 failed"))
          : Promise.resolve(undefined),
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "migration 2 failed",
    );

    const firstCheckpoint = vi
      .mocked(migrationModule.updateMigrationLabel)
      .mock.calls.find((call) => call[3] === 1);
    expect(firstCheckpoint).toBeDefined();
    expect(firstCheckpoint![5]).toBe(true);
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
    planResult.context.pendingMigrations = setPendingMigrations([
      mkAddTypeMigration(1, "New1"),
      migration2,
    ]);
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

    const createdTypeNames = client.createTailorDBType.mock.calls.map(
      (call) => call[0].tailordbType?.name,
    );
    expect(createdTypeNames).toContain("Audit");
    expect(createdTypeNames).toContain("New1");
    expect(
      vi.mocked(migrationModule.updateMigrationLabel).mock.calls.map((call) => call[3]),
    ).toEqual([1]);

    const updatedTypeNames = client.updateTailorDBType.mock.calls.map(
      (call) => call[0].tailordbType?.name,
    );
    expect(updatedTypeNames.filter((name) => name === "Existing")).toHaveLength(2);
    expect(updatedTypeNames).not.toContain("Audit");
    expect(updatedTypeNames).not.toContain("New1");
    expect(deletedTableNames(client)).toEqual(["New2"]);

    const restoredExisting = client.updateTailorDBType.mock.calls
      .filter((call) => call[0].tailordbType?.name === "Existing")
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
    client.updateTailorDBType.mockImplementation((request) => {
      const tableName = request.tailordbType?.name;
      const fieldType = request.tailordbType?.schema?.fields?.value?.type;
      if (!rejected && tableName === "Beta" && fieldType === "float") {
        rejected = true;
        return Promise.reject(new Error("post-phase update failed"));
      }
      return Promise.resolve({});
    });
    planResult.context.pendingMigrations = setPendingMigrations([
      mkFieldTypeMigration(1, tableNames),
    ]);

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
    planResult.context.pendingMigrations = setPendingMigrations([
      mkFieldTypeMigration(1, tableNames),
    ]);
    vi.mocked(migrationModule.updateMigrationLabel).mockRejectedValueOnce(
      new Error("checkpoint update failed"),
    );
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await withOverriddenSnapshot(
      (_migrationsDir, maxVersion) => snapshots(maxVersion ?? 0),
      async () => {
        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "checkpoint update failed",
        );
      },
    );

    expect(fieldTypeUpdates(client, "GoodsReceipt").at(-1)).toBe("float");
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/remote remains at 0000\. .* Repair the checkpoint before retrying\.$/),
    );
    warn.mockRestore();
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
    planResult.context.pendingMigrations = setPendingMigrations([
      mkFieldTypeMigration(1, tableNames),
    ]);
    vi.mocked(migrationModule.updateMigrationLabel).mockRejectedValueOnce(
      new Error("checkpoint response lost"),
    );
    client.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0001" } },
    });

    await withOverriddenSnapshot(
      (_migrationsDir, maxVersion) => snapshots(maxVersion ?? 0),
      async () => {
        await expect(applyTailorDB(client, planResult, "create-update")).resolves.toMatchObject({
          namespaces: ["test-ns"],
        });
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
    planResult.context.pendingMigrations = setPendingMigrations([
      mkFieldTypeMigration(1, tableNames),
    ]);
    client.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0002" } },
    });
    let writesAtCheckpointAttempt = 0;
    vi.mocked(migrationModule.updateMigrationLabel)
      .mockReset()
      .mockImplementationOnce(async () => {
        writesAtCheckpointAttempt = client.updateTailorDBType.mock.calls.length;
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
        return true;
      },
    );
    client.deleteTailorDBType.mockImplementation(async () => {
      order.push("delete");
      return {};
    });
    planResult.context.pendingMigrations = setPendingMigrations([
      mkRemoveTypeMigration(1, tableName),
    ]);

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
    client.createTailorDBType.mockRejectedValue(new Error("pre-phase create failed"));

    planResult.context.pendingMigrations = setPendingMigrations([
      mkAddTypeMigration(1, "StockReservation"),
    ]);

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

    planResult.context.pendingMigrations = setPendingMigrations([
      mkAddTypeMigration(1, "StockReservation"),
    ]);
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

    planResult.context.pendingMigrations = setPendingMigrations([
      mkAddTypeMigration(1, "StockReservation"),
    ]);
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

  describe("what is left restricted when restoration does not finish", () => {
    const restrictedWrite = (call: Parameters<OperatorClient["updateTailorDBType"]>) =>
      call[0].tailordbType?.schema?.settings?.disableGqlOperations?.create === true;

    function failRestoringGoodsReceipt(client: MockClient) {
      const original = client.updateTailorDBType.getMockImplementation();
      client.updateTailorDBType.mockImplementation(async (request, ...rest) => {
        const type = request.tailordbType;
        if (type?.name === "GoodsReceipt" && !restrictedWrite([request])) {
          throw new Error("settings write refused");
        }
        return original ? original(request, ...rest) : {};
      });
    }

    function checkpointReadsAfterCommit(
      client: MockClient,
      read: () => { number: number } | Error,
    ) {
      let committed = false;
      vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(
        async (_client, _workspaceId, _namespace, number, historyId) => {
          remoteCheckpoint.number = number;
          remoteCheckpoint.historyId = historyId ?? null;
          committed = true;
          return true;
        },
      );
      const original = client.getMetadata.getMockImplementation()!;
      client.getMetadata.mockImplementation(async (...args) => {
        if (!committed) return original(...args);
        const result = read();
        if (result instanceof Error) throw result;
        return {
          metadata: { labels: { "sdk-migration": `m${String(result.number).padStart(4, "0")}` } },
        };
      });
    }

    test("names the namespace and tables that stay restricted when restoring fails after a migration failure", async () => {
      const client = createMockClient();
      const planResult = withRestorableGoodsReceipt();
      failRestoringGoodsReceipt(client);
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddTypeMigration(1, "StockReservation"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
        new Error("original migration failure"),
      );
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const log = vi.spyOn(logger, "log").mockImplementation(() => {});

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "original migration failure",
      );

      const message = warn.mock.calls.map(([line]) => line).join("\n");
      expect(message).toContain("settings write refused");
      expect(message).toContain("namespace 'test-ns': GoodsReceipt");
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Deploy again"));
      warn.mockRestore();
      log.mockRestore();
    });

    test("reports the restricted tables as diagnostics when restoring is the only failure", async () => {
      const client = createMockClient();
      const planResult = withRestorableGoodsReceipt();
      failRestoringGoodsReceipt(client);
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddTypeMigration(1, "StockReservation"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);

      const error = await applyTailorDB(client, planResult, "create-update").catch(
        (thrown: Error) => thrown,
      );

      expect(error).toMatchObject({ message: "settings write refused" });
      expect(getErrorDiagnostics(error as Error)).toMatchObject({
        code: "MIGRATION_RESTORE_FAILED",
        suggestion: expect.stringContaining("Deploy again"),
        context: { unrestored: [{ namespace: "test-ns", tables: ["GoodsReceipt"] }] },
      });
    });

    test("tells how to inspect the checkpoint when its ownership cannot be verified", async () => {
      const client = createMockClient();
      checkpointReadsAfterCommit(client, () => new Error("metadata unavailable"));
      vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);

      const planResult = withRestorableGoodsReceipt();
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddTypeMigration(1, "StockReservation"),
      ]);
      planResult.context.migrationRecoveryArgs = ["--profile=staging"];

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toMatchObject({
        code: "MIGRATION_CHECKPOINT_UNVERIFIED",
        suggestion: expect.stringMatching(
          /`tailor tailordb migration status --namespace test-ns --config=\S+ --workspace-id=test-workspace --profile=staging`/,
        ),
        context: { namespace: "test-ns", tables: expect.arrayContaining(["GoodsReceipt"]) },
      });
      expect(vi.mocked(migrationModule.executeMigrations).mock.calls[0]![0]).toMatchObject({
        migrationRecoveryArgs: ["--profile=staging"],
      });
    });

    test("names the restricted tables in the text of the skipped-restoration suggestion", async () => {
      const client = createMockClient();
      const planResult = withRestorableGoodsReceipt();
      checkpointReadsAfterCommit(client, () => new Error("metadata unavailable"));
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddTypeMigration(1, "StockReservation"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);

      const error = await applyTailorDB(client, planResult, "create-update").catch(
        (thrown: Error) => thrown,
      );

      expect(errorToJson(error).error.suggestion).toContain("GoodsReceipt");
    });

    test("keeps the skipped restoration as structured context of the original failure", async () => {
      const client = createMockClient();
      const planResult = createUpdatePlanResult();
      checkpointReadsAfterCommit(client, () => new Error("metadata unavailable"));
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddFieldMigration(1, "GoodsReceipt", "note"),
        mkAddFieldMigration(2, "GoodsReceipt", "extra"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockImplementation(
        (_ctx: unknown, migrations: PendingMigration[]) =>
          migrations.some((m) => m.number === 2)
            ? Promise.reject(new Error("migration 2 failed"))
            : Promise.resolve(undefined),
      );
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const log = vi.spyOn(logger, "log").mockImplementation(() => {});

      const error = await applyTailorDB(client, planResult, "create-update").catch(
        (thrown: Error) => thrown,
      );

      expect(errorToJson(error).error).toMatchObject({
        message: "migration 2 failed",
        context: {
          "restorationSkipped:test-ns": {
            code: "MIGRATION_CHECKPOINT_UNVERIFIED",
            context: { namespace: "test-ns", tables: expect.arrayContaining(["GoodsReceipt"]) },
          },
        },
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(
          /^Could not verify ownership of migration checkpoint test-ns\/\S+ before restoring table settings\. Skipping restoration for this namespace and aborting this deployment\. Reason: metadata unavailable$/,
        ),
      );
      expect(log.mock.calls.at(-1)).toEqual(["The original migration error is reported below."]);
    });

    test("keeps a failed restoration as structured context of the original failure", async () => {
      const client = createMockClient();
      const planResult = withRestorableGoodsReceipt();
      failRestoringGoodsReceipt(client);
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddTypeMigration(1, "StockReservation"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
        new Error("original migration failure"),
      );
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      vi.spyOn(logger, "log").mockImplementation(() => {});

      const error = await applyTailorDB(client, planResult, "create-update").catch(
        (thrown: Error) => thrown,
      );

      expect(errorToJson(error).error).toMatchObject({
        message: "original migration failure",
        context: {
          restoration: {
            code: "MIGRATION_RESTORE_FAILED",
            context: { unrestored: [{ namespace: "test-ns", tables: ["GoodsReceipt"] }] },
          },
        },
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(
          /^Could not restore every TailorDB table after the migration failed\. Still restricted \(.+\): namespace 'test-ns': GoodsReceipt\. Reason: .*settings write refused$/,
        ),
      );
    });

    test("tells how to inspect the checkpoint when another deploy advanced it", async () => {
      const client = createMockClient();
      checkpointReadsAfterCommit(client, () => ({ number: 2 }));
      vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);

      const planResult = withRestorableGoodsReceipt();
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddTypeMigration(1, "StockReservation"),
      ]);
      planResult.context.migrationRecoveryArgs = ["--profile=staging"];

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toMatchObject({
        code: "MIGRATION_CHECKPOINT_CONFLICT",
        suggestion: expect.stringMatching(
          /`tailor tailordb migration status --namespace test-ns --config=\S+ --workspace-id=test-workspace --profile=staging`/,
        ),
        context: {
          namespace: "test-ns",
          expectedCheckpoint: 1,
          remoteCheckpoint: 2,
          tables: expect.arrayContaining(["GoodsReceipt"]),
        },
      });
    });

    test("shows the same guidance beside the original failure when the checkpoint cannot be verified", async () => {
      const client = createMockClient();
      const planResult = createUpdatePlanResult();
      checkpointReadsAfterCommit(client, () => new Error("metadata unavailable"));
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddFieldMigration(1, "GoodsReceipt", "note"),
        mkAddFieldMigration(2, "GoodsReceipt", "extra"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockImplementation(
        (_ctx: unknown, migrations: PendingMigration[]) =>
          migrations.some((m) => m.number === 2)
            ? Promise.reject(new Error("migration 2 failed"))
            : Promise.resolve(undefined),
      );
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const log = vi.spyOn(logger, "log").mockImplementation(() => {});

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "migration 2 failed",
      );

      expect(warn.mock.calls.map(([line]) => line).join("\n")).toContain("Skipping restoration");
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("tailor tailordb migration status --namespace test-ns"),
      );
      warn.mockRestore();
      log.mockRestore();
    });

    test("names the tables that stay restricted when the failed migration's new table cannot be removed", async () => {
      const client = createMockClient();
      const planResult = createMockPlanResult();
      client.deleteTailorDBType.mockRejectedValue(new Error("delete refused"));
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddTypeMigration(1, "StockReservation"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
        new Error("original migration failure"),
      );
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const log = vi.spyOn(logger, "log").mockImplementation(() => {});

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "original migration failure",
      );

      expect(warn.mock.calls.map(([line]) => line).join("\n")).toContain(
        "namespace 'test-ns': StockReservation",
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("Deploy again to run the migration again"),
      );
      expect(log).toHaveBeenCalledWith(expect.stringContaining("remote schema drift"));
      warn.mockRestore();
      log.mockRestore();
    });

    test("does not call an existing table restricted when only its rollback write failed and restoration can still lift it", async () => {
      const client = createMockClient();
      const planResult = withRestorableGoodsReceipt(createUpdatePlanResult());
      let migrationFailed = false;
      const original = client.updateTailorDBType.getMockImplementation();
      client.updateTailorDBType.mockImplementation(async (request, ...rest) => {
        const type = request.tailordbType;
        if (migrationFailed && type?.name === "GoodsReceipt" && restrictedWrite([request])) {
          throw new Error("transient rollback failure");
        }
        return original ? original(request, ...rest) : {};
      });
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddFieldMigration(1, "GoodsReceipt", "note"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockImplementation(async () => {
        migrationFailed = true;
        throw new Error("original migration failure");
      });
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      vi.spyOn(logger, "log").mockImplementation(() => {});

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "original migration failure",
      );

      const lines = warn.mock.calls.map(([line]) => line).join("\n");
      expect(lines).toContain("Failed to roll back table 'GoodsReceipt'");
      expect(lines).not.toContain("not rolled back completely");
      warn.mockRestore();
    });

    test("does not call a table restricted when the prior schema is missing but restoration still lifts it", async () => {
      const client = createMockClient();
      const planResult = withRestorableGoodsReceipt(createUpdatePlanResult());
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddFieldMigration(1, "GoodsReceipt", "note"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
        new Error("original migration failure"),
      );
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      vi.spyOn(logger, "log").mockImplementation(() => {});

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
        },
      );

      const lines = warn.mock.calls.map(([line]) => line).join("\n");
      expect(lines).toContain("Cannot roll back migration");
      expect(lines).not.toContain("Still restricted");
      warn.mockRestore();
    });

    test("leaves a table that already refuses writes out of the restricted tables it names", async () => {
      const client = createMockClient();
      const planResult = createMockPlanResult();
      client.listTailorDBTypes.mockResolvedValue({
        tailordbTypes: [
          {
            name: "GoodsReceipt",
            schema: {
              settings: {
                bulkUpsert: false,
                publishRecordEvents: false,
                disableGqlOperations: { create: true, update: true, delete: true, read: false },
              },
            },
          },
        ],
      });
      planResult.context.pendingMigrations = setPendingMigrations([
        {
          ...mkAddTypeMigration(1, "StockReservation"),
          scriptForm: { kind: "steps", order: ["a", "b"] },
        },
      ]);
      vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
        CLIError({ code: "MIGRATION_PARTIALLY_APPLIED", message: "failed at b after a completed" }),
      );
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      vi.spyOn(logger, "log").mockImplementation(() => {});

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "failed at b after a completed",
      );

      const lines = warn.mock.calls.map(([line]) => line).join("\n");
      expect(lines).toContain("namespace 'test-ns': StockReservation.");
      expect(lines).not.toContain("GoodsReceipt");
      warn.mockRestore();
    });

    test("keeps a table in the manual-repair warning when its restoration failed too", async () => {
      const client = createMockClient();
      const planResult = withRestorableGoodsReceipt(createUpdatePlanResult());
      failRestoringGoodsReceipt(client);
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddFieldMigration(1, "GoodsReceipt", "note"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
        new Error("original migration failure"),
      );
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const log = vi.spyOn(logger, "log").mockImplementation(() => {});

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
        },
      );

      expect(warn.mock.calls.map(([line]) => line).join("\n")).toContain(
        "was not rolled back completely",
      );
      expect(log).toHaveBeenCalledWith(expect.stringContaining("remote schema drift"));
      warn.mockRestore();
      log.mockRestore();
    });

    test("keeps an existing table in the manual-repair warning when its rollback write and its restoration both failed", async () => {
      const client = createMockClient();
      const planResult = withRestorableGoodsReceipt(createUpdatePlanResult());
      let migrationFailed = false;
      const original = client.updateTailorDBType.getMockImplementation();
      client.updateTailorDBType.mockImplementation(async (request, ...rest) => {
        const type = request.tailordbType;
        if (migrationFailed && type?.name === "GoodsReceipt") {
          throw new Error("write refused");
        }
        return original ? original(request, ...rest) : {};
      });
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddFieldMigration(1, "GoodsReceipt", "note"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockImplementation(async () => {
        migrationFailed = true;
        throw new Error("original migration failure");
      });
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const log = vi.spyOn(logger, "log").mockImplementation(() => {});

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "original migration failure",
      );

      expect(warn.mock.calls.map(([line]) => line).join("\n")).toContain(
        "was not rolled back completely",
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("Deploy again to run the migration again"),
      );
      expect(log).toHaveBeenCalledWith(expect.stringContaining("remote schema drift"));
      warn.mockRestore();
      log.mockRestore();
    });

    test("keeps an existing table in the manual-repair warning when its rollback write failed and the checkpoint changed so restoration was skipped", async () => {
      const client = createMockClient();
      const planResult = createUpdatePlanResult();
      checkpointReadsAfterCommit(client, () => ({ number: 5 }));
      let migrationFailed = false;
      const original = client.updateTailorDBType.getMockImplementation();
      client.updateTailorDBType.mockImplementation(async (request, ...rest) => {
        const type = request.tailordbType;
        if (migrationFailed && type?.name === "GoodsReceipt") {
          throw new Error("write refused");
        }
        return original ? original(request, ...rest) : {};
      });
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddFieldMigration(1, "GoodsReceipt", "note"),
        mkAddFieldMigration(2, "GoodsReceipt", "extra"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockImplementation(
        async (_ctx: unknown, migrations: PendingMigration[]) => {
          if (!migrations.some((m) => m.number === 2)) return;
          migrationFailed = true;
          throw new Error("migration 2 failed");
        },
      );
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      vi.spyOn(logger, "log").mockImplementation(() => {});

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "migration 2 failed",
      );

      const lines = warn.mock.calls.map(([line]) => line).join("\n");
      expect(lines).toContain("Skipping restoration");
      expect(lines).toContain("was not rolled back completely");
      warn.mockRestore();
    });

    test("does not call a new table restricted when it was never created and its delete finds nothing", async () => {
      const client = createMockClient();
      const planResult = createMockPlanResult();
      client.deleteTailorDBType.mockRejectedValue(
        new ConnectError("table not found", Code.NotFound),
      );
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddTypeMigration(1, "StockReservation"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
        new Error("original migration failure"),
      );
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const log = vi.spyOn(logger, "log").mockImplementation(() => {});

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "original migration failure",
      );

      const lines = warn.mock.calls.map(([line]) => line).join("\n");
      expect(lines).not.toContain("not rolled back completely");
      expect(lines).not.toContain("Failed to roll back table 'StockReservation'");
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining("remote schema drift"));
      warn.mockRestore();
      log.mockRestore();
    });

    test("keeps the request details and suggestion a failed restoration write already carried", async () => {
      const client = createMockClient();
      const planResult = withRestorableGoodsReceipt();
      const original = client.updateTailorDBType.getMockImplementation();
      client.updateTailorDBType.mockImplementation(async (request, ...rest) => {
        const type = request.tailordbType;
        if (type?.name === "GoodsReceipt" && !restrictedWrite([request])) {
          throw withErrorDiagnostics(new Error("settings write refused"), {
            suggestion: "Check the platform status.",
            context: { method: "UpdateTailorDBType", identifiers: { typeName: "GoodsReceipt" } },
          });
        }
        return original ? original(request, ...rest) : {};
      });
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddTypeMigration(1, "StockReservation"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
        new Error("original migration failure"),
      );
      vi.spyOn(logger, "warn").mockImplementation(() => {});
      vi.spyOn(logger, "log").mockImplementation(() => {});

      const error = await applyTailorDB(client, planResult, "create-update").catch(
        (thrown: Error) => thrown,
      );

      expect(errorToJson(error).error).toMatchObject({
        context: {
          restoration: {
            code: "MIGRATION_RESTORE_FAILED",
            suggestion: expect.stringContaining("Check the platform status."),
            context: {
              method: "UpdateTailorDBType",
              identifiers: { typeName: "GoodsReceipt" },
              unrestored: [{ namespace: "test-ns", tables: ["GoodsReceipt"] }],
            },
          },
        },
      });
    });

    test("keeps the way to release the tables when none of them can be named", () => {
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const log = vi.spyOn(logger, "log").mockImplementation(() => {});

      warnTablesLeftRestricted(
        "Could not restore every TailorDB table after the migration failed.",
        [{ namespace: "test-ns", tables: [] }],
        { namesUnknown: true, cause: new Error("settings write refused") },
      );

      expect(warn).toHaveBeenCalledWith(
        "Could not restore every TailorDB table after the migration failed. Reason: settings write refused",
      );
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Deploy again"));
      warn.mockRestore();
      log.mockRestore();
    });

    test("does not offer a release when no table is restricted at all", () => {
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const log = vi.spyOn(logger, "log").mockImplementation(() => {});

      warnTablesLeftRestricted("Migration test-ns/0001 is partially applied.", [
        { namespace: "test-ns", tables: [] },
      ]);

      expect(warn).toHaveBeenCalledOnce();
      expect(log).not.toHaveBeenCalled();
      warn.mockRestore();
      log.mockRestore();
    });

    test("names a write-disabled table that the migration itself rewrote", async () => {
      const client = createMockClient();
      const planResult = createUpdatePlanResult();
      client.listTailorDBTypes.mockResolvedValue({
        tailordbTypes: [
          {
            name: "GoodsReceipt",
            schema: {
              settings: {
                bulkUpsert: false,
                publishRecordEvents: false,
                disableGqlOperations: { create: true, update: true, delete: true, read: false },
              },
            },
          },
        ],
      });
      planResult.context.pendingMigrations = setPendingMigrations([
        {
          ...mkAddFieldMigration(1, "GoodsReceipt", "note"),
          scriptForm: { kind: "steps", order: ["a", "b"] },
        },
      ]);
      vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
        CLIError({ code: "MIGRATION_PARTIALLY_APPLIED", message: "failed at b after a completed" }),
      );
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      vi.spyOn(logger, "log").mockImplementation(() => {});

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "failed at b after a completed",
      );

      expect(warn.mock.calls.map(([line]) => line).join("\n")).toContain(
        "namespace 'test-ns': GoodsReceipt, StockReservation.",
      );
      warn.mockRestore();
    });

    test("names the tables a partially applied migration keeps restricted", async () => {
      const client = createMockClient();
      const planResult = createMockPlanResult();
      planResult.context.pendingMigrations = setPendingMigrations([
        {
          ...mkAddTypeMigration(1, "StockReservation"),
          scriptForm: { kind: "steps", order: ["a", "b"] },
        },
      ]);
      vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
        CLIError({ code: "MIGRATION_PARTIALLY_APPLIED", message: "failed at b after a completed" }),
      );
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const log = vi.spyOn(logger, "log").mockImplementation(() => {});

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "failed at b after a completed",
      );

      expect(warn.mock.calls.map(([line]) => line).join("\n")).toContain(
        "namespace 'test-ns': GoodsReceipt, StockReservation",
      );
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Deploy again"));
      warn.mockRestore();
      log.mockRestore();
    });
  });

  describe("the record of a `main` run", () => {
    aroundEach(async (runTest) => {
      vi.mocked(removeMigrationWorkflowResources).mockClear();
      vi.mocked(migrationModule.clearMigrationInProgress).mockClear();
      await runTest();
    });

    test("removes the run's resources once its checkpoint is committed", async () => {
      const client = createMockClient();
      const planResult = withInputs(createMockPlanResult());
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddTypeMigration(1, "StockReservation"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);

      await applyTailorDB(client, planResult, "create-update");

      expect(removeMigrationWorkflowResources).toHaveBeenCalledWith(
        client,
        "test-workspace",
        "test-ns",
        1,
      );
      expect(
        vi.mocked(migrationModule.updateMigrationLabel).mock.invocationCallOrder[0],
      ).toBeLessThan(vi.mocked(removeMigrationWorkflowResources).mock.invocationCallOrder[0]!);
    });

    test("clears the record before it rolls the schema back when the post-phase fails", async () => {
      const client = createMockClient();
      const planResult = withInputs(createUpdatePlanResult());
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddFieldMigration(1, "GoodsReceipt", "note"),
      ]);
      vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);
      const goodsReceiptWrites = failPostPhase(client);

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "post-phase constraint violation",
      );

      expect(goodsReceiptWrites[3]).not.toEqual(goodsReceiptWrites[1]);
      expect(migrationModule.clearMigrationInProgress).toHaveBeenCalledWith(
        client,
        "test-workspace",
        "test-ns",
      );
      expect(
        vi.mocked(migrationModule.clearMigrationInProgress).mock.invocationCallOrder[0],
      ).toBeLessThan(client.updateTailorDBType.mock.invocationCallOrder.at(-1)!);
      expect(removeMigrationWorkflowResources).toHaveBeenCalledWith(
        client,
        "test-workspace",
        "test-ns",
        1,
      );
      expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
    });

    test("keeps the pre-migration schema and points to migration resolve when the record cannot be cleared after the post-phase fails", async () => {
      const client = createMockClient();
      vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);
      vi.mocked(migrationModule.clearMigrationInProgress).mockRejectedValueOnce(
        new Error("label write rejected"),
      );
      client.getMetadata.mockResolvedValue({
        metadata: {
          labels: { "sdk-migration": "m0000", "sdk-migration-in-progress": "m0001-main" },
        },
      });
      const goodsReceiptWrites = failPostPhase(client);
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const log = vi.spyOn(logger, "log").mockImplementation(() => {});
      const planResult = withInputs(createUpdatePlanResult());
      planResult.context.pendingMigrations = setPendingMigrations([
        mkAddFieldMigration(1, "GoodsReceipt", "note"),
      ]);
      planResult.context.migrationRecoveryArgs = ["--profile=staging"];

      const error = await applyTailorDB(client, planResult, "create-update").catch(
        (caught: unknown) => caught,
      );

      expect(error).toMatchObject({
        code: "MIGRATION_PARTIALLY_APPLIED",
        message: expect.stringContaining("post-phase constraint violation"),
        suggestion: expect.stringMatching(
          /`tailor tailordb migration resolve --complete --namespace test-ns --config=\S+ --workspace-id=test-workspace --profile=staging`/,
        ),
      });
      expect(warn).toHaveBeenCalledWith(
        "Could not clear the in-progress record of migration test-ns/0001: label write rejected",
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("settle it with 'tailor tailordb migration resolve'."),
      );
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining("deploy again to resume it"));
      expect(goodsReceiptWrites[3]).toEqual(goodsReceiptWrites[1]);
      expect(removeMigrationWorkflowResources).not.toHaveBeenCalled();
    });
  });

  describe("a multi-step migration whose steps partly committed", () => {
    const stepsForm: MigrationScriptForm = { kind: "steps", order: ["backfill", "recompute"] };

    function mkStepsMigration(): PendingMigration {
      return { ...mkAddTypeMigration(1, "StockReservation"), scriptForm: stepsForm };
    }

    function partiallyApplied(): Error {
      return CLIError({
        code: "MIGRATION_PARTIALLY_APPLIED",
        message: "Migration test-ns/0001 failed at recompute after backfill completed: boom",
      });
    }

    function remoteInProgress(state: Partial<RemoteMigrationState>) {
      return mockPendingMigrations(state.number === 1 ? [] : [mkStepsMigration()], () => ({
        number: 0,
        historyId: null,
        ...state,
      }));
    }

    aroundEach(async (runTest) => {
      vi.mocked(removeMigrationWorkflowResources).mockClear();
      await runTest();
    });

    test("keeps the Pre-phase schema and the restrictions in place", async () => {
      const client = createMockClient();
      const planResult = withInputs(createMockPlanResult());
      planResult.context.pendingMigrations = setPendingMigrations([mkStepsMigration()]);
      vi.mocked(migrationModule.executeMigrations).mockRejectedValue(partiallyApplied());

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "failed at recompute",
      );

      expect(client.createTailorDBType).toHaveBeenCalledTimes(1);
      expect(deletedTableNames(client)).not.toContain("StockReservation");
      expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
      expect(lastGoodsReceiptSettings(client)?.disableGqlOperations).toEqual({
        create: true,
        update: true,
        delete: true,
        read: false,
      });
    });

    test("names a table an earlier deploy already restricted when the retry stops again", async () => {
      const client = createMockClient();
      const planResult = withInputs(createMockPlanResult());
      planResult.context.pendingMigrations = remoteInProgress({
        inProgress: { number: 1, executionId: "exec-1", kind: "steps" },
      });
      client.listTailorDBTypes.mockResolvedValue({
        tailordbTypes: [
          {
            name: "GoodsReceipt",
            schema: {
              settings: {
                bulkUpsert: false,
                publishRecordEvents: false,
                disableGqlOperations: { create: true, update: true, delete: true, read: true },
              },
            },
          },
        ],
      });
      vi.mocked(migrationModule.executeMigrations).mockRejectedValue(partiallyApplied());
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      vi.spyOn(logger, "log").mockImplementation(() => {});

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "failed at recompute",
      );

      expect(warn.mock.calls.map(([line]) => line).join("\n")).toContain("GoodsReceipt");
      warn.mockRestore();
    });

    describe("a script that asks to roll back on failure", () => {
      const rollbackForm: MigrationScriptForm = {
        kind: "steps",
        order: ["backfill", "recompute"],
        rollbackOnFailure: true,
      };

      function runEndedPartiallyApplied(): Error {
        return CLIError({
          code: "MIGRATION_PARTIALLY_APPLIED",
          message: "Migration test-ns/0001 failed at recompute after backfill completed: boom",
          context: { runEnded: true },
        });
      }

      function mkRollbackMigration(): PendingMigration {
        return { ...mkAddTypeMigration(1, "StockReservation"), scriptForm: rollbackForm };
      }

      aroundEach(async (runTest) => {
        vi.mocked(migrationModule.clearMigrationInProgress).mockClear();
        await runTest();
      });

      test("rolls back the Pre-phase schema and drops the run's records when a step fails after another completed", async () => {
        const client = createMockClient();
        const planResult = withInputs(createMockPlanResult());
        planResult.context.pendingMigrations = setPendingMigrations([mkRollbackMigration()]);
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());

        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "failed at recompute",
        );

        expect(deletedTableNames(client)).toContain("StockReservation");
        expect(migrationModule.clearMigrationInProgress).toHaveBeenCalledWith(
          client,
          "test-workspace",
          "test-ns",
        );
        expect(removeMigrationWorkflowResources).toHaveBeenCalledWith(
          client,
          "test-workspace",
          "test-ns",
          1,
        );
        expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
      });

      test("returns the schema to the state before the migration when the post-phase fails after every step succeeded", async () => {
        const client = createMockClient();
        const planResult = withInputs(createUpdatePlanResult());
        planResult.context.pendingMigrations = setPendingMigrations([
          { ...mkAddFieldMigration(1, "GoodsReceipt", "note"), scriptForm: rollbackForm },
        ]);
        vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);
        const goodsReceiptWrites = failPostPhase(client, requiredFieldNullValuesError());

        const error = await applyTailorDB(client, planResult, "create-update").catch(
          (caught: unknown) => caught,
        );

        expect(errorToJson(error).error).toMatchObject({
          code: "MIGRATION_ROLLED_BACK",
          suggestion: expect.stringContaining("Please check your migration script."),
        });
        expect(errorToJson(error).error.suggestion).not.toContain("--migration-skip-steps");
        expect(goodsReceiptWrites[3]).not.toEqual(goodsReceiptWrites[1]);
        expect(migrationModule.clearMigrationInProgress).toHaveBeenCalledWith(
          client,
          "test-workspace",
          "test-ns",
        );
        expect(removeMigrationWorkflowResources).toHaveBeenCalledWith(
          client,
          "test-workspace",
          "test-ns",
          1,
        );
        expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
      });

      test("logs the failed rollback write of an existing table that restoration then reverts, and raises the original failure", async () => {
        const client = createMockClient();
        const planResult = withInputs(createUpdatePlanResult());
        planResult.context.pendingMigrations = setPendingMigrations([
          { ...mkAddFieldMigration(1, "GoodsReceipt", "note"), scriptForm: rollbackForm },
        ]);
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());
        const goodsReceiptWrites: unknown[] = [];
        client.updateTailorDBType.mockImplementation(async (request) => {
          if (request.tailordbType?.name !== "GoodsReceipt") return {};
          goodsReceiptWrites.push(structuredClone(request));
          // Restriction, Pre-phase, then the rollback write that fails.
          if (goodsReceiptWrites.length === 3) throw new Error("rollback rejected");
          return {};
        });

        const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
        vi.spyOn(logger, "log").mockImplementation(() => {});

        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "failed at recompute",
        );

        const warnings = warn.mock.calls.map(([line]) => line).join("\n");
        expect(warnings).toContain("Failed to roll back table 'GoodsReceipt'");
        expect(warnings).not.toContain("was not rolled back completely");
        warn.mockRestore();
        expect(migrationModule.clearMigrationInProgress).toHaveBeenCalledWith(
          client,
          "test-workspace",
          "test-ns",
        );
      });

      test("leaves the schema and the run's resources in place when the in-progress record could not be cleared", async () => {
        const client = createMockClient();
        const planResult = withInputs(createUpdatePlanResult());
        planResult.context.pendingMigrations = setPendingMigrations([
          { ...mkAddFieldMigration(1, "GoodsReceipt", "note"), scriptForm: rollbackForm },
        ]);
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());
        vi.mocked(migrationModule.clearMigrationInProgress).mockRejectedValueOnce(
          new Error("label write rejected"),
        );
        client.getMetadata.mockResolvedValue({
          metadata: {
            labels: { "sdk-migration": "m0000", "sdk-migration-in-progress": "m0001" },
          },
        });
        const goodsReceiptWrites: unknown[] = [];
        client.updateTailorDBType.mockImplementation(async (request) => {
          if (request.tailordbType?.name !== "GoodsReceipt") return {};
          goodsReceiptWrites.push(structuredClone(request));
          return {};
        });

        const error = await applyTailorDB(client, planResult, "create-update").catch(
          (caught: unknown) => caught,
        );

        expect(error).toMatchObject({
          code: "MIGRATION_PARTIALLY_APPLIED",
          message: expect.stringContaining("failed at recompute"),
          suggestion: expect.stringContaining(
            "tailor tailordb migration resolve --rollback --namespace test-ns",
          ),
        });
        expect(goodsReceiptWrites).toHaveLength(2);
        expect(removeMigrationWorkflowResources).not.toHaveBeenCalled();
      });

      test("reports a table whose GraphQL permission could not be restored even though restoration writes its definition back", async () => {
        const client = createMockClient();
        const planResult = createUpdatePlanResult();
        planResult.changeSet.gqlPermission.updates = [
          {
            name: "GoodsReceipt",
            request: {
              workspaceId: "test-workspace",
              namespaceName: "test-ns",
              typeName: "GoodsReceipt",
              permission: { policies: [{ description: "after" }] },
            },
            previousPermission: { policies: [{ description: "before" }] },
          },
        ];
        planResult.context.pendingMigrations = setPendingMigrations([
          { ...mkAddFieldMigration(1, "GoodsReceipt", "note"), scriptForm: rollbackForm },
        ]);
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());
        client.updateTailorDBGQLPermission
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(new Error("permission write rejected"));

        const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
        vi.spyOn(logger, "log").mockImplementation(() => {});

        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "failed at recompute",
        );

        const warnings = warn.mock.calls.map(([line]) => line).join("\n");
        expect(warnings).toContain(
          "Failed to roll back the GraphQL permission of table 'GoodsReceipt'",
        );
        expect(warnings).toContain(
          "GraphQL permissions needing manual repair in namespace 'test-ns': GoodsReceipt",
        );
        warn.mockRestore();
      });

      test("reports a new table that could not be dropped as needing manual repair", async () => {
        const client = createMockClient();
        const planResult = withInputs(createMockPlanResult());
        planResult.context.pendingMigrations = setPendingMigrations([mkRollbackMigration()]);
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());
        client.deleteTailorDBType.mockRejectedValue(new Error("drop rejected"));
        const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
        vi.spyOn(logger, "log").mockImplementation(() => {});

        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "failed at recompute",
        );

        const warnings = warn.mock.calls.map(([line]) => line).join("\n");
        expect(warnings).toContain("was not rolled back completely");
        expect(warnings).toContain("StockReservation");
        warn.mockRestore();
      });

      test("keeps the Pre-phase schema and the run when the outcome of the script is unknown", async () => {
        const client = createMockClient();
        const planResult = withInputs(createMockPlanResult());
        planResult.context.pendingMigrations = setPendingMigrations([mkRollbackMigration()]);
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
          CLIError({ code: "MIGRATION_OUTCOME_UNKNOWN", message: "outcome unknown" }),
        );

        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "outcome unknown",
        );

        expect(deletedTableNames(client)).not.toContain("StockReservation");
        expect(migrationModule.clearMigrationInProgress).not.toHaveBeenCalled();
      });

      test("raises an error that says the migration was rolled back and what the next deploy does", async () => {
        const client = createMockClient();
        const planResult = withInputs(createMockPlanResult());
        planResult.context.pendingMigrations = setPendingMigrations([mkRollbackMigration()]);
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());

        const error = await applyTailorDB(client, planResult, "create-update").catch(
          (caught: unknown) => caught,
        );

        expect(error).toMatchObject({
          code: "MIGRATION_ROLLED_BACK",
          message: expect.stringContaining("failed at recompute"),
          suggestion: expect.stringContaining("runs every step again from the beginning"),
        });
      });

      test.each([
        {
          reason: "the checkpoint changed",
          code: "MIGRATION_CHECKPOINT_CONFLICT",
          message:
            "Migration checkpoint test-ns/0000 changed to 0002 before migration test-ns/0001 started.",
        },
        {
          reason: "the checkpoint could not be read",
          code: "MIGRATION_CHECKPOINT_UNVERIFIED",
          message:
            "Could not confirm migration checkpoint test-ns/0000 before migration test-ns/0001 started: [unavailable] lost",
        },
      ])(
        "rolls back the Pre-phase schema and reports the refusal itself when $reason before the run",
        async ({ code, message }) => {
          const client = createMockClient();
          const planResult = withInputs(createMockPlanResult());
          planResult.context.pendingMigrations = setPendingMigrations([mkRollbackMigration()]);
          vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
            CLIError({ code, message }),
          );

          const error = await applyTailorDB(client, planResult, "create-update").catch(
            (caught: unknown) => caught,
          );

          expect(error).toMatchObject({ code, message });
          expect(deletedTableNames(client)).toContain("StockReservation");
          expect(migrationModule.clearMigrationInProgress).not.toHaveBeenCalled();
        },
      );

      test("rolls back a Pre-phase schema failure without touching the in-progress record", async () => {
        const client = createMockClient();
        const planResult = withInputs(createMockPlanResult());
        planResult.context.pendingMigrations = setPendingMigrations([mkRollbackMigration()]);
        const clearRecord = vi.mocked(migrationModule.clearMigrationInProgress);
        const clearRecordImplementation = clearRecord.getMockImplementation();
        clearRecord.mockRejectedValue(new Error("label write rejected"));
        client.createTailorDBType.mockRejectedValueOnce(new Error("create rejected"));

        const error = await applyTailorDB(client, planResult, "create-update").catch(
          (caught: unknown) => caught,
        );

        expect(error).toMatchObject({
          code: "MIGRATION_ROLLED_BACK",
          message: expect.stringContaining("create rejected"),
        });
        expect(migrationModule.clearMigrationInProgress).not.toHaveBeenCalled();
        expect(deletedTableNames(client)).toContain("StockReservation");
        clearRecord.mockImplementation(clearRecordImplementation!);
      });

      test("still rolls back what this deploy wrote and raises the failure when the prior checkpoint cannot be read", async () => {
        const client = createMockClient();
        const planResult = withInputs(createMockPlanResult());
        let failed = false;
        planResult.context.pendingMigrations = leaveInProgress(mkRollbackMigration());
        vi.mocked(migrationModule.executeMigrations).mockImplementation(async () => {
          failed = true;
          throw runEndedPartiallyApplied();
        });
        const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
        const log = vi.spyOn(logger, "log").mockImplementation(() => {});

        await withOverriddenSnapshot(
          (migrationsDir, maxVersion) => {
            if (failed && maxVersion === 0) throw new Error("snapshot unreadable");
            return snapshotFixtures.reconstructSnapshotFromMigrations(
              migrationsDir,
              maxVersion,
            ) as SchemaSnapshot;
          },
          async () => {
            await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
              "failed at recompute",
            );
          },
        );

        expect(warn).toHaveBeenCalledWith(
          "Could not read migration test-ns/0001 or its prior checkpoint: snapshot unreadable",
        );
        expect(log).toHaveBeenCalledWith("Only what this deploy wrote is rolled back.");
        warn.mockRestore();
        log.mockRestore();
      });

      test("does not roll back while the run may still be executing", async () => {
        const client = createMockClient();
        const planResult = withInputs(createMockPlanResult());
        planResult.context.pendingMigrations = setPendingMigrations([mkRollbackMigration()]);
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(partiallyApplied());

        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "failed at recompute",
        );

        expect(deletedTableNames(client)).not.toContain("StockReservation");
        expect(migrationModule.clearMigrationInProgress).not.toHaveBeenCalled();
        expect(removeMigrationWorkflowResources).not.toHaveBeenCalled();
      });

      function leaveInProgress(migration: PendingMigration, ...following: PendingMigration[]) {
        return mockPendingMigrations([migration, ...following], () => ({
          number: 0,
          historyId: null,
          inProgress: { number: 1, executionId: "exec-1", kind: "steps" },
        }));
      }

      test("undoes a permission an earlier Pre-phase installed when a later pending migration removes it again", async () => {
        const client = createMockClient();
        const installedGql = [{ conditions: [], actions: ["all"], permit: "allow" }];
        const planResult = withInputs(createUpdatePlanResult());
        planResult.context.pendingMigrations = leaveInProgress(
          { ...mkAddFieldMigration(1, "GoodsReceipt", "note"), scriptForm: rollbackForm },
          mkAddFieldMigration(2, "GoodsReceipt", "extra"),
        );
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());

        await withOverriddenSnapshot(
          (migrationsDir, maxVersion) => {
            const snapshot = snapshotFixtures.reconstructSnapshotFromMigrations(
              migrationsDir,
              maxVersion,
            ) as SchemaSnapshot;
            if (maxVersion !== 1) return snapshot;
            return {
              ...snapshot,
              tables: {
                ...snapshot.tables,
                GoodsReceipt: {
                  ...snapshot.tables.GoodsReceipt,
                  permissions: { gql: installedGql },
                },
              },
            } as SchemaSnapshot;
          },
          async () => {
            await expect(applyTailorDB(client, planResult, "create-update")).rejects.toMatchObject({
              code: "MIGRATION_ROLLED_BACK",
            });
          },
        );

        expect(client.deleteTailorDBGQLPermission).toHaveBeenCalledWith(
          expect.objectContaining({ typeName: "GoodsReceipt" }),
        );
      });

      test.each([
        ["the same migration's record remains", { "sdk-migration-in-progress": "m0001" }, true],
        ["the remote state belongs to another run", { "sdk-migration": "m0001" }, false],
      ])(
        "after a post-phase failure with the record not cleared, %s",
        async (_label, extraLabels, reapplies) => {
          const client = createMockClient();
          const planResult = withInputs(createUpdatePlanResult());
          planResult.context.pendingMigrations = setPendingMigrations([
            { ...mkAddFieldMigration(1, "GoodsReceipt", "note"), scriptForm: rollbackForm },
          ]);
          vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);
          vi.mocked(migrationModule.clearMigrationInProgress).mockRejectedValueOnce(
            new Error("response lost"),
          );
          client.getMetadata.mockResolvedValue({
            metadata: { labels: { "sdk-migration": "m0000", ...extraLabels } },
          });
          const goodsReceiptWrites = failPostPhase(client);

          const error = await applyTailorDB(client, planResult, "create-update").catch(
            (caught: unknown) => caught,
          );

          expect(error).toMatchObject({ code: "MIGRATION_PARTIALLY_APPLIED" });
          expect(goodsReceiptWrites).toHaveLength(reapplies ? 4 : 3);
          expect(goodsReceiptWrites.at(3) === undefined).toBe(!reapplies);
          expect(goodsReceiptWrites.at(3) ?? goodsReceiptWrites[1]).toEqual(goodsReceiptWrites[1]);
        },
      );

      test("rolls back a migration that an earlier deploy left in progress", async () => {
        const client = createMockClient();
        const planResult = withInputs(createMockPlanResult());
        planResult.context.pendingMigrations = leaveInProgress(mkRollbackMigration());
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());

        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "failed at recompute",
        );

        expect(deletedTableNames(client)).toContain("StockReservation");
        expect(migrationModule.clearMigrationInProgress).toHaveBeenCalledWith(
          client,
          "test-workspace",
          "test-ns",
        );
        expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
      });

      test("restores the GraphQL permission of the prior checkpoint when it rolls back a migration an earlier deploy left in progress", async () => {
        const client = createMockClient();
        const priorGql = [{ conditions: [], actions: ["all"], permit: "allow" }];
        const laterGql = [{ conditions: [], actions: ["read"], permit: "allow" }];
        const planResult = withInputs(createUpdatePlanResult());
        planResult.context.pendingMigrations = leaveInProgress({
          ...mkAddFieldMigration(1, "GoodsReceipt", "note"),
          scriptForm: rollbackForm,
        });
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());

        await withOverriddenSnapshot(
          (migrationsDir, maxVersion) => {
            const snapshot = snapshotFixtures.reconstructSnapshotFromMigrations(
              migrationsDir,
              maxVersion,
            ) as SchemaSnapshot;
            const gql = maxVersion === 0 ? priorGql : laterGql;
            return {
              ...snapshot,
              tables: {
                ...snapshot.tables,
                GoodsReceipt: { ...snapshot.tables.GoodsReceipt, permissions: { gql } },
              },
            } as SchemaSnapshot;
          },
          async () => {
            await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
              "failed at recompute",
            );
          },
        );

        expect(client.updateTailorDBGQLPermission).toHaveBeenCalledWith(
          expect.objectContaining({
            typeName: "GoodsReceipt",
            permission: protoGqlPermission(priorGql as SnapshotGqlPermission),
          }),
        );
      });

      test("rolls back when clearing the record failed but the record is gone", async () => {
        const client = createMockClient();
        const planResult = withInputs(createMockPlanResult());
        planResult.context.pendingMigrations = setPendingMigrations([mkRollbackMigration()]);
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());
        vi.mocked(migrationModule.clearMigrationInProgress).mockRejectedValueOnce(
          new Error("response lost"),
        );
        client.getMetadata.mockResolvedValue({
          metadata: { labels: { "sdk-migration": "m0000" } },
        });

        const error = await applyTailorDB(client, planResult, "create-update").catch(
          (caught: unknown) => caught,
        );

        expect(error).toMatchObject({ code: "MIGRATION_ROLLED_BACK" });
        expect(deletedTableNames(client)).toContain("StockReservation");
      });

      test.each([
        ["the checkpoint moved on", { "sdk-migration": "m0001" }],
        [
          "another migration is recorded as in progress",
          { "sdk-migration": "m0000", "sdk-migration-in-progress": "m0002" },
        ],
      ])("does not roll back when clearing the record failed and %s", async (_label, labels) => {
        const client = createMockClient();
        const planResult = withInputs(createMockPlanResult());
        planResult.context.pendingMigrations = setPendingMigrations([mkRollbackMigration()]);
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());
        vi.mocked(migrationModule.clearMigrationInProgress).mockRejectedValueOnce(
          new Error("response lost"),
        );
        client.getMetadata.mockResolvedValue({ metadata: { labels } });

        const error = await applyTailorDB(client, planResult, "create-update").catch(
          (caught: unknown) => caught,
        );

        expect(error).toMatchObject({ code: "MIGRATION_PARTIALLY_APPLIED" });
        expect(deletedTableNames(client)).not.toContain("StockReservation");
      });

      test("restores the permission the final settings installed even when the failing migration's snapshot has the checkpoint's", async () => {
        const client = createMockClient();
        const checkpointGql = [{ conditions: [], actions: ["all"], permit: "allow" }];
        const finalGql = [{ conditions: [], actions: ["read"], permit: "allow" }];
        const planResult = withInputs(createUpdatePlanResult());
        planResult.context.pendingMigrations = setPendingMigrations([
          { ...mkAddFieldMigration(1, "GoodsReceipt", "note"), scriptForm: rollbackForm },
          mkAddFieldMigration(2, "GoodsReceipt", "extra"),
        ]);
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());

        await withOverriddenSnapshot(
          (migrationsDir, maxVersion) => {
            const snapshot = snapshotFixtures.reconstructSnapshotFromMigrations(
              migrationsDir,
              maxVersion,
            ) as SchemaSnapshot;
            const gql = (maxVersion ?? 0) <= 1 ? checkpointGql : finalGql;
            return {
              ...snapshot,
              tables: {
                ...snapshot.tables,
                GoodsReceipt: { ...snapshot.tables.GoodsReceipt, permissions: { gql } },
              },
            } as SchemaSnapshot;
          },
          async () => {
            await expect(applyTailorDB(client, planResult, "create-update")).rejects.toMatchObject({
              code: "MIGRATION_ROLLED_BACK",
            });
          },
        );

        expect(client.updateTailorDBGQLPermission.mock.calls.at(-1)?.[0]).toMatchObject({
          typeName: "GoodsReceipt",
          permission: protoGqlPermission(checkpointGql as SnapshotGqlPermission),
        });
      });

      test("restores the checkpoint's permission over the one an earlier Pre-phase installed when the checkpoint and the final settings agree", async () => {
        const client = createMockClient();
        const checkpointGql = [{ conditions: [], actions: ["read"], permit: "allow" }];
        const installedGql = [{ conditions: [], actions: ["all"], permit: "allow" }];
        const planResult = createUpdatePlanResult();
        planResult.changeSet.gqlPermission.updates = [
          {
            name: "GoodsReceipt",
            request: {
              workspaceId: "test-workspace",
              namespaceName: "test-ns",
              typeName: "GoodsReceipt",
              permission: protoGqlPermission(checkpointGql as SnapshotGqlPermission),
            },
            previousPermission: protoGqlPermission(installedGql as SnapshotGqlPermission),
          },
        ];
        planResult.context.pendingMigrations = leaveInProgress({
          ...mkAddFieldMigration(1, "GoodsReceipt", "note"),
          scriptForm: rollbackForm,
        });
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());

        await withOverriddenSnapshot(
          (migrationsDir, maxVersion) => {
            const snapshot = snapshotFixtures.reconstructSnapshotFromMigrations(
              migrationsDir,
              maxVersion,
            ) as SchemaSnapshot;
            return {
              ...snapshot,
              tables: {
                ...snapshot.tables,
                GoodsReceipt: {
                  ...snapshot.tables.GoodsReceipt,
                  permissions: { gql: checkpointGql },
                },
              },
            } as SchemaSnapshot;
          },
          async () => {
            await expect(
              applyTailorDB(client, withInputs(planResult), "create-update"),
            ).rejects.toMatchObject({ code: "MIGRATION_ROLLED_BACK" });
          },
        );

        expect(client.updateTailorDBGQLPermission.mock.calls.at(-1)?.[0]).toMatchObject({
          typeName: "GoodsReceipt",
          permission: protoGqlPermission(checkpointGql as SnapshotGqlPermission),
        });
      });

      test("keeps restoring a table outside the migration snapshots when it rolls back a resumed migration", async () => {
        const client = createMockClient();
        const planResult = withInputs(createUpdatePlanResult());
        planResult.context.pendingMigrations = leaveInProgress({
          ...mkAddFieldMigration(1, "GoodsReceipt", "note"),
          scriptForm: rollbackForm,
        });
        client.listTailorDBTypes.mockResolvedValue({
          tailordbTypes: [
            {
              name: "GoodsReceipt",
              schema: {
                settings: {
                  bulkUpsert: false,
                  publishRecordEvents: false,
                  disableGqlOperations: { create: true, update: true, delete: true, read: true },
                },
              },
            },
            {
              name: "Unrelated",
              schema: {
                settings: {
                  bulkUpsert: true,
                  publishRecordEvents: true,
                  disableGqlOperations: {
                    create: false,
                    update: false,
                    delete: false,
                    read: false,
                  },
                },
              },
            },
          ],
        });
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());

        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "failed at recompute",
        );

        const unrelatedWrites = client.updateTailorDBType.mock.calls
          .map(([request]) => request.tailordbType)
          .filter((type) => type?.name === "Unrelated");
        expect(unrelatedWrites.at(-1)?.schema?.settings?.disableGqlOperations).toMatchObject({
          create: false,
        });
      });

      test("keeps a resumed migration in progress when its Pre-phase fails before the runner inspects the earlier run", async () => {
        const client = createMockClient();
        const planResult = withInputs(createMockPlanResult());
        planResult.context.pendingMigrations = leaveInProgress(mkRollbackMigration());
        client.createTailorDBType.mockRejectedValueOnce(new Error("create rejected"));

        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "create rejected",
        );

        expect(migrationModule.clearMigrationInProgress).not.toHaveBeenCalled();
        expect(removeMigrationWorkflowResources).not.toHaveBeenCalled();
        expect(deletedTableNames(client)).not.toContain("StockReservation");
      });

      test("keeps a resumed migration in progress when the earlier run may still be executing", async () => {
        const client = createMockClient();
        const planResult = withInputs(createMockPlanResult());
        planResult.context.pendingMigrations = leaveInProgress(mkRollbackMigration());
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(partiallyApplied());

        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "failed at recompute",
        );

        expect(migrationModule.clearMigrationInProgress).not.toHaveBeenCalled();
        expect(deletedTableNames(client)).not.toContain("StockReservation");
      });

      test("rolls back only the failing migration and keeps the checkpoint of the one before it", async () => {
        const client = createMockClient();
        const planResult = withInputs(createUpdatePlanResult());
        planResult.context.pendingMigrations = setPendingMigrations([
          mkAddFieldMigration(1, "GoodsReceipt", "note"),
          { ...mkAddFieldMigration(2, "GoodsReceipt", "extra"), scriptForm: rollbackForm },
        ]);
        vi.mocked(migrationModule.executeMigrations)
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(runEndedPartiallyApplied());

        const error = await applyTailorDB(client, planResult, "create-update").catch(
          (caught: unknown) => caught,
        );

        expect(error).toMatchObject({ code: "MIGRATION_ROLLED_BACK" });
        expect(
          vi.mocked(migrationModule.updateMigrationLabel).mock.calls.map((call) => call[3]),
        ).toEqual([1]);
        expect(migrationModule.clearMigrationInProgress).toHaveBeenCalledWith(
          client,
          "test-workspace",
          "test-ns",
        );
      });

      test("drops a table an earlier deploy created even though this deploy's plan leaves it unchanged", async () => {
        const client = createMockClient();
        const planResult = withInputs(createUpdatePlanResult());
        planResult.context.pendingMigrations = leaveInProgress(mkRollbackMigration());
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());

        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "failed at recompute",
        );

        expect(deletedTableNames(client)).toContain("StockReservation");
      });

      test("restores the prior checkpoint's permission over the one this deploy's forced update recorded", async () => {
        const client = createMockClient();
        const priorGql = [{ conditions: [], actions: ["all"], permit: "allow" }];
        const laterGql = [{ conditions: [], actions: ["read"], permit: "allow" }];
        const planResult = createUpdatePlanResult();
        planResult.changeSet.gqlPermission.updates = [
          {
            name: "GoodsReceipt",
            request: {
              workspaceId: "test-workspace",
              namespaceName: "test-ns",
              typeName: "GoodsReceipt",
              permission: protoGqlPermission(laterGql as SnapshotGqlPermission),
            },
            previousPermission: protoGqlPermission(laterGql as SnapshotGqlPermission),
          },
        ];
        planResult.context.pendingMigrations = leaveInProgress({
          ...mkAddFieldMigration(1, "GoodsReceipt", "note"),
          scriptForm: rollbackForm,
        });
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());

        await withOverriddenSnapshot(
          (migrationsDir, maxVersion) => {
            const snapshot = snapshotFixtures.reconstructSnapshotFromMigrations(
              migrationsDir,
              maxVersion,
            ) as SchemaSnapshot;
            const gql = maxVersion === 0 ? priorGql : laterGql;
            return {
              ...snapshot,
              tables: {
                ...snapshot.tables,
                GoodsReceipt: { ...snapshot.tables.GoodsReceipt, permissions: { gql } },
              },
            } as SchemaSnapshot;
          },
          async () => {
            await expect(
              applyTailorDB(client, withInputs(planResult), "create-update"),
            ).rejects.toThrow("failed at recompute");
          },
        );

        expect(client.updateTailorDBGQLPermission.mock.calls.at(-1)?.[0]).toMatchObject({
          typeName: "GoodsReceipt",
          permission: protoGqlPermission(priorGql as SnapshotGqlPermission),
        });
      });

      test("writes the settings of the schema it returned to, not an earlier deploy's restrictions, when it rolls back a migration left in progress", async () => {
        const client = createMockClient();
        const planResult = withInputs(createUpdatePlanResult());
        planResult.context.pendingMigrations = leaveInProgress({
          ...mkAddFieldMigration(1, "GoodsReceipt", "note"),
          scriptForm: rollbackForm,
        });
        client.listTailorDBTypes.mockResolvedValue({
          tailordbTypes: [
            {
              name: "GoodsReceipt",
              schema: {
                settings: {
                  bulkUpsert: false,
                  publishRecordEvents: false,
                  disableGqlOperations: { create: true, update: true, delete: true, read: true },
                },
              },
            },
          ],
        });
        vi.mocked(migrationModule.executeMigrations).mockRejectedValue(runEndedPartiallyApplied());

        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "failed at recompute",
        );

        expect(lastGoodsReceiptSettings(client)?.disableGqlOperations?.create ?? false).toBe(false);
      });
    });

    test("passes the recorded run to the migration and never rolls back while it is in progress", async () => {
      const client = createMockClient();
      const planResult = createMockPlanResult();
      planResult.context.pendingMigrations = remoteInProgress({
        inProgress: { number: 1, executionId: "exec-1", kind: "steps" },
      });
      vi.mocked(migrationModule.executeMigrations).mockRejectedValue(new Error("still failing"));

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "still failing",
      );

      expect(vi.mocked(migrationModule.executeMigrations).mock.calls[0]?.[3]).toEqual({
        "test-ns": { number: 1, executionId: "exec-1", kind: "steps" },
      });
      expect(deletedTableNames(client)).not.toContain("StockReservation");
      expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
    });

    test("stays in progress when the post-phase fails after every step succeeded", async () => {
      const client = createMockClient();
      const planResult = withInputs(createUpdatePlanResult());
      planResult.context.pendingMigrations = setPendingMigrations([
        { ...mkAddFieldMigration(1, "GoodsReceipt", "note"), scriptForm: stepsForm },
      ]);
      vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);
      const goodsReceiptWrites = failPostPhase(client, requiredFieldNullValuesError());

      const error = await applyTailorDB(client, planResult, "create-update").catch(
        (caught: unknown) => caught,
      );

      expect(errorToJson(error).error).toMatchObject({
        code: "TAILORDB_REQUIRED_FIELD_HAS_NULL_VALUES",
        suggestion: expect.stringMatching(
          /Editing a completed step has no effect\..*--migration-skip-steps test-ns\/backfill,test-ns\/recompute /,
        ),
      });
      // The Pre-phase schema is written again, so the next deploy finds the
      // shape the in-progress migration expects.
      expect(goodsReceiptWrites).toHaveLength(4);
      expect(goodsReceiptWrites[3]).toEqual(goodsReceiptWrites[1]);
      expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
      expect(removeMigrationWorkflowResources).not.toHaveBeenCalled();
    });

    describe("a script with a single step", () => {
      const singleStep: MigrationScriptForm = { kind: "steps", order: ["backfill"] };

      test("removes the run's resources once it completes, like a main script", async () => {
        const client = createMockClient();
        const planResult = createMockPlanResult();
        planResult.context.pendingMigrations = setPendingMigrations([
          { ...mkStepsMigration(), scriptForm: singleStep },
        ]);
        vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);

        await applyTailorDB(client, planResult, "create-update");

        expect(migrationModule.updateMigrationLabel).toHaveBeenCalledWith(
          client,
          "test-workspace",
          "test-ns",
          1,
          undefined,
          true,
          false,
        );
        expect(removeMigrationWorkflowResources).toHaveBeenCalledWith(
          client,
          "test-workspace",
          "test-ns",
          1,
        );
      });

      test("is rolled back like a main script when the post-phase fails", async () => {
        const client = createMockClient();
        const planResult = withInputs(createUpdatePlanResult());
        planResult.context.pendingMigrations = setPendingMigrations([
          { ...mkAddFieldMigration(1, "GoodsReceipt", "note"), scriptForm: singleStep },
        ]);
        vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);
        const goodsReceiptWrites = failPostPhase(client, requiredFieldNullValuesError());

        const error = await applyTailorDB(client, planResult, "create-update").catch(
          (caught: unknown) => caught,
        );

        expect(errorToJson(error).error).toMatchObject({
          code: "TAILORDB_REQUIRED_FIELD_HAS_NULL_VALUES",
          suggestion: expect.stringContaining("Please check your migration script."),
        });
        expect(errorToJson(error).error.suggestion).not.toContain("--migration-skip-steps");
        // The schema goes back to the state before the migration, as for a main script;
        // the Pre-phase schema is not written again, which only a resumable run needs.
        expect(goodsReceiptWrites[3]).not.toEqual(goodsReceiptWrites[1]);
        expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
      });

      test("says completed steps do not run again when the post-phase of a resumed run fails", async () => {
        const client = createMockClient();
        const planResult = withInputs(createUpdatePlanResult());
        planResult.context.pendingMigrations = mockPendingMigrations(
          [{ ...mkAddFieldMigration(1, "GoodsReceipt", "note"), scriptForm: singleStep }],
          () => ({
            number: 0,
            historyId: null,
            inProgress: { number: 1, executionId: "exec-1", kind: "steps" },
          }),
        );
        vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);
        failPostPhase(client, requiredFieldNullValuesError());

        const error = await applyTailorDB(client, planResult, "create-update").catch(
          (caught: unknown) => caught,
        );

        expect(errorToJson(error).error).toMatchObject({
          code: "TAILORDB_REQUIRED_FIELD_HAS_NULL_VALUES",
          suggestion: expect.stringContaining("--migration-skip-steps test-ns/backfill"),
        });
        expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
      });
    });

    test("advances the checkpoint and removes the run's resources once the steps complete", async () => {
      const client = createMockClient();
      const planResult = createMockPlanResult();
      planResult.context.pendingMigrations = setPendingMigrations([mkStepsMigration()]);
      vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);

      await applyTailorDB(client, planResult, "create-update");

      expect(migrationModule.updateMigrationLabel).toHaveBeenCalledWith(
        client,
        "test-workspace",
        "test-ns",
        1,
        undefined,
        true,
        false,
      );
      expect(removeMigrationWorkflowResources).toHaveBeenCalledWith(
        client,
        "test-workspace",
        "test-ns",
        1,
      );
    });

    test("clears an in-progress record whose migration is already committed", async () => {
      const client = createMockClient();
      const planResult = buildPlanResult({});
      remoteCheckpoint.number = 1;
      planResult.context.pendingMigrations = remoteInProgress({
        number: 1,
        inProgress: { number: 1, kind: "steps" },
      });
      client.getMetadata.mockResolvedValue({
        metadata: {
          labels: { "sdk-migration": "m0001", "sdk-migration-in-progress": "m0001" },
        },
      });

      await applyTailorDB(client, planResult, "create-update");

      const removals = client.setMetadata.mock.calls.map(([request]) => request.labels);
      expect(removals.at(-1)).not.toHaveProperty("sdk-migration-in-progress");
      expect(removeMigrationWorkflowResources).toHaveBeenCalledWith(
        client,
        "test-workspace",
        "test-ns",
        1,
      );
    });

    test("rejects a step that cannot be skipped before it changes any table or runs the migration", async () => {
      const client = createMockClient();
      vi.mocked(assertSkippableSteps).mockRejectedValueOnce(
        CLIError({ code: "MIGRATION_SKIP_STEPS_INVALID", message: "cannot skip recompute" }),
      );
      vi.mocked(migrationModule.executeMigrations).mockClear();
      client.updateTailorDBType.mockClear();
      const plan = withInputs(createMockPlanResult());
      plan.context.pendingMigrations = remoteInProgress({
        inProgress: { number: 1, executionId: "exec-1", kind: "steps" },
      });
      plan.context.migrationSkipSteps = new Map([["test-ns", ["recompute"]]]);

      await expect(applyTailorDB(client, plan, "create-update")).rejects.toMatchObject({
        code: "MIGRATION_SKIP_STEPS_INVALID",
      });

      expect(assertSkippableSteps).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: "test-ns",
          migrationNumber: 1,
          order: ["backfill", "recompute"],
          requested: ["recompute"],
        }),
      );
      expect(migrationModule.executeMigrations).not.toHaveBeenCalled();
      expect(client.updateTailorDBType).not.toHaveBeenCalled();
    });

    test("rejects a step that cannot be skipped in the preflight that runs before any deployment is applied", async () => {
      const client = createMockClient();
      vi.mocked(assertSkippableSteps).mockRejectedValueOnce(
        CLIError({ code: "MIGRATION_SKIP_STEPS_INVALID", message: "cannot skip recompute" }),
      );
      const plan = withInputs(createMockPlanResult());
      plan.context.pendingMigrations = remoteInProgress({
        inProgress: { number: 1, executionId: "exec-1", kind: "steps" },
      });
      plan.context.migrationSkipSteps = new Map([["test-ns", ["recompute"]]]);

      await expect(preflightTailorDB(client, plan)).rejects.toMatchObject({
        code: "MIGRATION_SKIP_STEPS_INVALID",
      });
      expect(client.updateTailorDBType).not.toHaveBeenCalled();
    });

    test("ignores steps requested for a namespace this config does not define", async () => {
      const client = createMockClient();
      vi.mocked(assertSkippableSteps).mockClear();
      vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);
      const plan = withInputs(createMockPlanResult());
      plan.context.pendingMigrations = remoteInProgress({
        inProgress: { number: 1, executionId: "exec-1", kind: "steps" },
      });
      plan.context.migrationSkipSteps = new Map([["other-app-ns", ["recompute"]]]);

      await applyTailorDB(client, plan, "create-update");

      expect(assertSkippableSteps).not.toHaveBeenCalled();
    });

    test("lifts maintenance mode on the tables the resumed migration created", async () => {
      const client = createMockClient();
      const planResult = withInputs(createMockPlanResult());
      planResult.context.pendingMigrations = remoteInProgress({
        inProgress: { number: 1, executionId: "exec-1", kind: "steps" },
      });
      const restrictedOperations = { create: true, update: true, delete: true, read: true };
      const restricted = {
        bulkUpsert: false,
        publishRecordEvents: false,
        disableGqlOperations: restrictedOperations,
      };
      client.listTailorDBTypes.mockResolvedValue({
        tailordbTypes: [
          { name: "GoodsReceipt", schema: { settings: restricted } },
          { name: "StockReservation", schema: { settings: restricted } },
        ],
      });
      vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);

      await applyTailorDB(client, planResult, "create-update");

      const writes = client.updateTailorDBType.mock.calls.filter(
        (call) => call[0].tailordbType?.name === "StockReservation",
      );
      const settings = writes.at(-1)?.[0].tailordbType?.schema?.settings;
      expect(settings).toBeDefined();
      expect(settings?.disableGqlOperations).not.toEqual(restrictedOperations);
    });

    test("lifts maintenance mode when a resumed migration's checkpoint write cannot be confirmed", async () => {
      const client = createMockClient();
      const planResult = withInputs(createMockPlanResult());
      planResult.context.pendingMigrations = remoteInProgress({
        inProgress: { number: 1, executionId: "exec-1", kind: "steps" },
      });
      const restrictedOperations = { create: true, update: true, delete: true, read: true };
      const restricted = {
        bulkUpsert: false,
        publishRecordEvents: false,
        disableGqlOperations: restrictedOperations,
      };
      client.listTailorDBTypes.mockResolvedValue({
        tailordbTypes: [
          { name: "GoodsReceipt", schema: { settings: restricted } },
          { name: "StockReservation", schema: { settings: restricted } },
        ],
      });
      vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);
      vi.mocked(migrationModule.updateMigrationLabel).mockRejectedValueOnce(
        new Error("checkpoint update failed"),
      );

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "checkpoint update failed",
      );

      const lastSettings = (tableName: string) => {
        const writes = client.updateTailorDBType.mock.calls.filter(
          (call) => call[0].tailordbType?.name === tableName,
        );
        return writes.at(-1)?.[0].tailordbType?.schema?.settings;
      };
      expect(lastSettings("GoodsReceipt")).toBeDefined();
      expect(lastSettings("GoodsReceipt")?.disableGqlOperations).not.toEqual(restrictedOperations);
      expect(lastSettings("StockReservation")).toBeDefined();
      expect(lastSettings("StockReservation")?.disableGqlOperations).not.toEqual(
        restrictedOperations,
      );
    });

    test("points to a deploy that resumes it when its checkpoint write cannot be confirmed", async () => {
      const client = createMockClient();
      const planResult = withInputs(createMockPlanResult());
      planResult.context.pendingMigrations = setPendingMigrations([mkStepsMigration()]);
      vi.mocked(migrationModule.executeMigrations).mockResolvedValue(undefined);
      vi.mocked(migrationModule.updateMigrationLabel).mockRejectedValueOnce(
        new Error("checkpoint update failed"),
      );
      client.getMetadata.mockResolvedValue({
        metadata: {
          labels: { "sdk-migration": "m0000", "sdk-migration-in-progress": "m0001" },
        },
      });
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      vi.spyOn(logger, "log").mockImplementation(() => {});

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "checkpoint update failed",
      );

      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(
          /test-ns\/0001 could not be confirmed after its update failed; .* Deploy again to resume the migration; steps that already completed do not run again unless you add, remove, or rename a step, change the order the steps run in, or the earlier run was canceled or is no longer available\.$/,
        ),
      );
      warn.mockRestore();
    });

    test("leaves an in-progress migration's schema alone when the deploy fails before reaching it", async () => {
      const client = createMockClient();
      const planResult = withInputs(createMockPlanResult());
      planResult.context.pendingMigrations = remoteInProgress({
        inProgress: { number: 1, executionId: "exec-1", kind: "steps" },
      });
      client.updateTailorDBType.mockRejectedValueOnce(new Error("restriction write failed"));

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "restriction write failed",
      );

      expect(migrationModule.executeMigrations).not.toHaveBeenCalled();
      expect(client.updateTailorDBType).toHaveBeenCalledTimes(1);
    });
  });
});
