/**
 * A table rename migration must create the new table in the Pre-phase, keep the
 * old type alive while the copy script runs, and drop the old type (and its
 * GQL permission) only after the checkpoint advances.
 */

import { describe, test, expect, vi, aroundEach } from "vitest";
import { applyTailorDB, captureMigrationFileState } from "./index";
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
  const userType = {
    name: "User",
    pluralForm: "Users",
    fields: {
      email: { type: "string", required: false },
    },
  };
  const personType = {
    name: "Person",
    pluralForm: "People",
    fields: {
      email: { type: "string", required: false },
    },
  };
  const orderType = (ownerTarget: string) => ({
    name: "Order",
    pluralForm: "Orders",
    fields: {
      ownerId: {
        type: "uuid",
        required: false,
        foreignKey: true,
        foreignKeyType: ownerTarget,
        foreignKeyField: "id",
      },
    },
  });

  const typesByMigration: Record<number, unknown> = {
    0: { User: userType, Order: orderType("User") },
    1: { Person: personType, Order: orderType("Person") },
  };

  return {
    userType,
    personType,
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

import * as migrationModule from "./migration";

const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

describe("applyTailorDB: type rename migration flow", () => {
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

  function buildPlanResult(options: { withOrderUpdate?: boolean } = {}) {
    const mockService = {
      namespace: "test-ns",
      loadTypes: vi.fn().mockResolvedValue({}),
      types: {},
    } as unknown as TailorDBService;

    return {
      changeSet: {
        service: changeSetGroup("TailorDB Services"),
        type: changeSetGroup("TailorDB tables", {
          creates: [
            {
              name: "Person",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-ns",
                tailordbType: {
                  name: "Person",
                  schema: {
                    fields: {
                      email: { type: "string", required: false },
                    },
                  },
                },
              },
            },
          ],
          updates: options.withOrderUpdate
            ? [
                {
                  name: "Order",
                  request: {
                    workspaceId: "test-workspace",
                    namespaceName: "test-ns",
                    tailordbType: {
                      name: "Order",
                      schema: {
                        fields: {
                          ownerId: {
                            type: "uuid",
                            required: false,
                            foreignKey: true,
                            foreignKeyType: "Person",
                            foreignKeyField: "id",
                          },
                        },
                      },
                    },
                  },
                },
              ]
            : [],
          deletes: [
            {
              name: "User",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-ns",
                tailordbTypeName: "User",
              },
            },
          ],
        }),
        gqlPermission: changeSetGroup("TailorDB GQL Permissions", {
          deletes: [
            {
              name: "User",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-ns",
                typeName: "User",
              },
            },
          ],
        }),
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  function mkTypeRenameMigration(
    number: number,
    options: { withOrderRetarget?: boolean } = {},
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
            kind: "table_renamed",
            tableName: "Person",
            previousTableName: "User",
            before: snapshotFixtures.userType,
            after: snapshotFixtures.personType,
          },
          ...(options.withOrderRetarget
            ? [
                {
                  kind: "field_modified",
                  tableName: "Order",
                  fieldName: "ownerId",
                  before: {
                    type: "uuid",
                    required: false,
                    foreignKey: true,
                    foreignKeyType: "User",
                    foreignKeyField: "id",
                  },
                  after: {
                    type: "uuid",
                    required: false,
                    foreignKey: true,
                    foreignKeyType: "Person",
                    foreignKeyField: "id",
                  },
                },
              ]
            : []),
        ],
        hasBreakingChanges: true,
        breakingChanges: [{ tableName: "Person", reason: "Type renamed from User to Person" }],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  function setPendingMigrations(migrations: PendingMigration[]): void {
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue(migrations);
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

  test("creates the new table before the script and drops the old table after the checkpoint", async () => {
    const client = createMockClient();
    const planResult = buildPlanResult();
    setPendingMigrations([mkTypeRenameMigration(1)]);

    const order: string[] = [];
    vi.mocked(client.createTailorDBType).mockImplementation(async (req: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      order.push(`create:${(req as any)?.tailordbType?.name}`);
      return {} as never;
    });
    vi.mocked(migrationModule.executeMigrations).mockImplementation(async () => {
      order.push("script");
    });
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(
      async (_client, _workspaceId, _namespace, number, historyId) => {
        remoteCheckpoint.number = number;
        remoteCheckpoint.historyId = historyId ?? null;
        order.push("checkpoint");
      },
    );
    vi.mocked(client.deleteTailorDBGQLPermission).mockImplementation(async (req: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      order.push(`delete-perm:${(req as any)?.typeName}`);
      return {} as never;
    });
    vi.mocked(client.deleteTailorDBType).mockImplementation(async (req: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      order.push(`delete-type:${(req as any)?.tailordbTypeName}`);
      return {} as never;
    });

    await applyTailorDB(client, planResult, "create-update");

    expect(order).toEqual([
      "create:Person",
      "script",
      "checkpoint",
      "delete-perm:User",
      "delete-type:User",
    ]);
  });

  test("keeps the old type and does not advance the checkpoint when the script fails", async () => {
    const client = createMockClient();
    const planResult = buildPlanResult();
    setPendingMigrations([mkTypeRenameMigration(1)]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = copy failed"),
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow("copy failed");

    // Rollback removes the type created by the Pre-phase...
    const deleted = vi.mocked(client.deleteTailorDBType).mock.calls.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c) => (c[0] as any)?.tailordbTypeName,
    );
    expect(deleted).toContain("Person");
    // ...but never the old type that still holds the data.
    expect(deleted).not.toContain("User");
    expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
  });

  test("restores retargeted tables before deleting the new table on rollback", async () => {
    const client = createMockClient();
    const planResult = buildPlanResult({ withOrderUpdate: true });
    setPendingMigrations([mkTypeRenameMigration(1, { withOrderRetarget: true })]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = copy failed"),
    );

    const order: string[] = [];
    vi.mocked(client.updateTailorDBType).mockImplementation(async (req: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      order.push(`update:${(req as any)?.tailordbType?.name}`);
      return {} as never;
    });
    vi.mocked(client.deleteTailorDBType).mockImplementation(async (req: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      order.push(`delete-type:${(req as any)?.tailordbTypeName}`);
      return {} as never;
    });

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow("copy failed");

    // Order must be restored to its prior schema (pointing back at User)
    // before Person is deleted, or the delete would be rejected while Order
    // still references Person.
    const restoreIndex = order.lastIndexOf("update:Order");
    const deleteIndex = order.indexOf("delete-type:Person");
    expect(restoreIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(restoreIndex);
    expect(order.filter((entry) => entry === "delete-type:User")).toEqual([]);
  });
});
