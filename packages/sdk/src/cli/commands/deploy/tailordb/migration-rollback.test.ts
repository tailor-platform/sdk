/**
 * A failed `migrate.ts` must leave the workspace at its prior checkpoint AND its
 * prior schema. The Pre-migration phase commits schema DDL (new types, relaxed
 * columns) before `migrate.ts` runs; when the data migration fails, the apply
 * loop must roll that DDL back so the schema does not sit ahead of the (un-advanced)
 * migration checkpoint and surface as opaque "Remote schema drift" on later deploys.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { applyTailorDB } from "./index";
import type { PendingMigration } from "@/cli/commands/tailordb/migrate/types";
import type { Application } from "@/cli/services/application";
import type { TailorDBService } from "@/cli/services/tailordb/service";
import type { OperatorClient } from "@/cli/shared/client";
import type { LoadedConfig } from "@/cli/shared/config-loader";

vi.mock("../label", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("../label");
  return {
    ...original,
    buildMetaRequest: vi.fn().mockResolvedValue({
      trn: "trn:v1:workspace:test-workspace:tailordb:test-ns",
      labels: {},
    }),
  };
});

vi.mock("../change-set", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("../change-set");
  return {
    ...original,
    createChangeSet: (title: string) => ({
      ...original.createChangeSet(title),
      print: () => {},
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
    updateMigrationLabel: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/cli/commands/tailordb/migrate/config", () => ({
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

  // Migration 1 introduces a brand new type (StockReservation), which does not
  // exist at the prior checkpoint (migration 0), and adds a `note` field to the
  // pre-existing GoodsReceipt type.
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
  };

  return {
    reconstructSnapshotFromMigrations: (migrationsDir: string, maxVersion?: number) => {
      void migrationsDir;
      const number = maxVersion ?? 0;
      const types = typesByMigration[number];
      if (!types) {
        throw new Error(`No snapshot fixture configured for migration number: ${number}`);
      }
      return {
        version: 1 as const,
        namespace: "test-ns",
        createdAt: new Date().toISOString(),
        types,
      };
    },
  };
});

vi.mock("@/cli/commands/tailordb/migrate/snapshot", async (importOriginal) => {
  const original =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    (await importOriginal()) as typeof import("@/cli/commands/tailordb/migrate/snapshot");
  return {
    ...original,
    assertValidMigrationFiles: vi.fn(),
    reconstructSnapshotFromMigrations: vi.fn(snapshotFixtures.reconstructSnapshotFromMigrations),
  };
});

import { reconstructSnapshotFromMigrations } from "@/cli/commands/tailordb/migrate/snapshot";
import * as migrationModule from "./migration";

const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

describe("applyTailorDB: rollback of Pre-migration DDL when migrate.ts fails", () => {
  function createMockClient() {
    return {
      createTailorDBService: vi.fn().mockResolvedValue({}),
      setMetadata: vi.fn().mockResolvedValue({}),
      createTailorDBType: vi.fn().mockResolvedValue({}),
      updateTailorDBType: vi.fn().mockResolvedValue({}),
      createTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      updateTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBType: vi.fn().mockResolvedValue({}),
      deleteTailorDBService: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  function createMockPlanResult() {
    const mockService = {
      namespace: "test-ns",
      loadTypes: vi.fn().mockResolvedValue({}),
      types: {},
    } as unknown as TailorDBService;

    const stockReservationCreate = {
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
    };

    return {
      changeSet: {
        service: {
          creates: [],
          updates: [],
          deletes: [],
          title: "TailorDB Services",
          isEmpty: () => true,
          print: () => {},
        },
        type: {
          creates: [
            {
              name: "StockReservation",
              request: stockReservationCreate,
            },
          ],
          updates: [],
          deletes: [],
          title: "TailorDB Types",
          isEmpty: () => false,
          print: () => {},
        },
        gqlPermission: {
          creates: [],
          updates: [],
          deletes: [],
          title: "TailorDB GQL Permissions",
          isEmpty: () => true,
          print: () => {},
        },
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
        executorUsedTypes: new Set<string>(),
        config: mockConfig,
        noSchemaCheck: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  function createUpdatePlanResult() {
    const mockService = {
      namespace: "test-ns",
      loadTypes: vi.fn().mockResolvedValue({}),
      types: {},
    } as unknown as TailorDBService;

    const goodsReceiptUpdate = {
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
    };

    return {
      changeSet: {
        service: {
          creates: [],
          updates: [],
          deletes: [],
          title: "TailorDB Services",
          isEmpty: () => true,
          print: () => {},
        },
        type: {
          creates: [],
          updates: [
            {
              name: "GoodsReceipt",
              request: goodsReceiptUpdate,
            },
          ],
          deletes: [],
          title: "TailorDB Types",
          isEmpty: () => false,
          print: () => {},
        },
        gqlPermission: {
          creates: [],
          updates: [],
          deletes: [],
          title: "TailorDB GQL Permissions",
          isEmpty: () => true,
          print: () => {},
        },
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
        executorUsedTypes: new Set<string>(),
        config: mockConfig,
        noSchemaCheck: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  function mkAddFieldMigration(
    number: number,
    typeName: string,
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
            typeName,
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

  function mkAddTypeMigration(number: number, typeName: string): PendingMigration {
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
            kind: "type_added",
            typeName,
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("deletes the type created by the failed migration's Pre-phase and does not advance the checkpoint", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkAddTypeMigration(1, "StockReservation"),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = Error: field 'supplierSnapshotName' not found"),
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "supplierSnapshotName",
    );

    // Pre-phase committed the DDL (the new type was created)...
    expect(client.createTailorDBType).toHaveBeenCalledTimes(1);

    // ...so the failed apply must roll it back: StockReservation did not exist at
    // the prior checkpoint, so it is dropped.
    const deleteCalls = vi.mocked(client.deleteTailorDBType).mock.calls;
    const deletedNames = deleteCalls.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c) => (c[0] as any)?.tailordbTypeName,
    );
    expect(deletedNames).toContain("StockReservation");

    // The checkpoint must stay at the prior migration.
    expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
  });

  test("restores a pre-existing type to its prior-checkpoint schema when migrate.ts fails", async () => {
    const client = createMockClient();
    const planResult = createUpdatePlanResult();

    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkAddFieldMigration(1, "GoodsReceipt", "note"),
    ]);
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

  test("surfaces the original migration error even when the rollback itself fails", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkAddTypeMigration(1, "StockReservation"),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = original migration failure"),
    );

    // Make rollback's prior-snapshot reconstruction throw (e.g. missing files),
    // while the pre-phase reconstruction (migration N) still succeeds.
    const snap = vi.mocked(reconstructSnapshotFromMigrations);
    type SnapImpl = Parameters<typeof snap.mockImplementation>[0];
    snap.mockImplementation(((migrationsDir: string, maxVersion?: number) => {
      if ((maxVersion ?? 0) === 0) {
        throw new Error("rollback snapshot reconstruction failed");
      }
      return snapshotFixtures.reconstructSnapshotFromMigrations(migrationsDir, maxVersion);
    }) as SnapImpl);

    try {
      // The original failure must surface, not the rollback error.
      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        "original migration failure",
      );
      expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
    } finally {
      snap.mockImplementation(snapshotFixtures.reconstructSnapshotFromMigrations as SnapImpl);
    }
  });
});
