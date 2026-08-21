/**
 * Breaking table-level index changes must be relaxed in the Pre-phase (previous
 * definition, or absent for additions) so migrate.ts can reconcile duplicate
 * rows before the Post-phase enforces the unique index.
 */

import { describe, test, expect, vi, aroundEach } from "vitest";
import * as migrationModule from "./migration";
import { applyTailorDB, captureMigrationFileState } from "./index";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { Application } from "#/cli/services/application";
import type { TailorDBService } from "#/cli/services/tailordb/service";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";

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
    executeMigrations: vi.fn().mockResolvedValue(undefined),
    updateMigrationLabel: vi.fn().mockResolvedValue(undefined),
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
  const userType = (indexes: Record<string, { fields: string[]; unique?: boolean }>) => ({
    name: "User",
    pluralForm: "Users",
    fields: {
      name: { type: "string", required: true },
      org: { type: "string", required: true },
    },
    indexes,
  });

  const typesByMigration: Record<number, unknown> = {
    0: {},
    // Migration 1 adds a new unique index over (name, org).
    1: { User: userType({ name_org: { fields: ["name", "org"], unique: true } }) },
    // Migration 2 turns the existing name_idx into a unique index.
    2: { User: userType({ name_idx: { fields: ["name"], unique: true } }) },
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

const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

describe("migration flow: breaking index changes across Pre/Post phases", () => {
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
          creates: [],
          updates: [
            {
              name: "User",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-ns",
                tailordbType: { name: "User", schema: { fields: {} } },
              },
            },
          ],
          deletes: [],
          unchanged: [],
          title: "TailorDB tables",
          isEmpty: () => false,
          lines: () => [],
        },
        gqlPermission: {
          creates: [],
          updates: [],
          deletes: [],
          title: "TailorDB GQL Permissions",
          isEmpty: () => true,
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
          tailorDBServices: [mockService],
          authService: undefined,
        } as unknown as Application,
        tailorDBInputs: [],
        executorUsedTables: new Set<string>(),
        config: mockConfig,
        noSchemaCheck: true,
        checkpointRepairs: [],
        namespacesWithMigrations: [
          {
            namespace: "test-ns",
            migrationsDir: "/test/migrations",
          },
        ],
        migrationFileState: captureMigrationFileState([
          {
            namespace: "test-ns",
            migrationsDir: "/test/migrations",
          },
        ]),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function mkIndexMigration(number: number, change: Record<string, unknown>): PendingMigration {
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
        changes: [change],
        hasBreakingChanges: true,
        breakingChanges: [{ tableName: "User", reason: "Unique constraint added to index" }],
        requiresMigrationScript: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function sentIndexes(call: readonly unknown[]): Record<string, any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((call[0] as any)?.tailordbType?.schema?.indexes ?? {}) as Record<string, any>;
  }

  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test("prePhase omits a newly-added unique index; postPhase applies it", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkIndexMigration(1, {
        kind: "index_added",
        tableName: "User",
        indexName: "name_org",
        after: { fields: ["name", "org"], unique: true },
      }),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const updateCalls = vi.mocked(client.updateTailorDBType).mock.calls;
    expect(updateCalls).toHaveLength(2);

    expect(sentIndexes(updateCalls[0]!).name_org).toBeUndefined();
    expect(sentIndexes(updateCalls[1]!).name_org).toEqual({
      fieldNames: ["name", "org"],
      unique: true,
    });
  });

  test("prePhase keeps the previous definition for an index gaining unique; postPhase enforces it", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkIndexMigration(2, {
        kind: "index_modified",
        tableName: "User",
        indexName: "name_idx",
        before: { fields: ["name"], unique: false },
        after: { fields: ["name"], unique: true },
      }),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const updateCalls = vi.mocked(client.updateTailorDBType).mock.calls;
    expect(updateCalls).toHaveLength(2);

    expect(sentIndexes(updateCalls[0]!).name_idx).toEqual({
      fieldNames: ["name"],
      unique: false,
    });
    expect(sentIndexes(updateCalls[1]!).name_idx).toEqual({
      fieldNames: ["name"],
      unique: true,
    });
  });
});
