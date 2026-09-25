/**
 * TailorDB apply runs after staticWebsite apply in the same deploy pass, so a
 * site this deploy just created already exists by the time a migration script
 * executes -- even though `application.env` was resolved earlier, at build
 * time, before that site existed. `buildMigrationContextForScripts` must
 * re-resolve `env` right before building the migration context, the same way
 * cors/OAuth2/IdP values are re-resolved right before their own apply calls.
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

vi.mock("#/cli/commands/tailordb/migrate/config", () => ({
  getNamespacesWithMigrations: vi.fn().mockReturnValue([
    {
      namespace: "test-ns",
      migrationsDir: "/test/migrations",
    },
  ]),
}));

vi.mock("#/cli/commands/tailordb/migrate/snapshot", async (importOriginal) => {
  const original =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    (await importOriginal()) as typeof import("#/cli/commands/tailordb/migrate/snapshot");
  return {
    ...original,
    assertValidMigrationFiles: vi.fn(),
    reconstructSnapshotFromMigrations: vi.fn().mockReturnValue({
      version: 1 as const,
      namespace: "test-ns",
      createdAt: new Date().toISOString(),
      tables: {},
    }),
  };
});

import * as migrationModule from "./migration";

const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

describe("applyTailorDB: env static website URL resolution for migration scripts", () => {
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
      getStaticWebsite: vi.fn().mockResolvedValue({
        staticwebsite: { url: "https://my-site.tailor.tech" },
      }),
    } as unknown as OperatorClient;
  }

  function buildPlanResult(applicationEnv: Application["env"]) {
    const mockService = {
      namespace: "test-ns",
      loadTypes: vi.fn().mockResolvedValue({}),
      types: {},
    } as unknown as TailorDBService;

    return {
      changeSet: {
        service: { creates: [], updates: [], deletes: [], unchanged: [], lines: () => [] },
        type: {
          creates: [
            {
              name: "StockReservation",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-ns",
                tailordbType: {
                  name: "StockReservation",
                  schema: { fields: [{ name: "id", type: "uuid", required: true }] },
                },
              },
            },
          ],
          updates: [],
          deletes: [],
          unchanged: [],
          lines: () => [],
        },
        gqlPermission: { creates: [], updates: [], deletes: [], unchanged: [], lines: () => [] },
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
          env: applicationEnv,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  function mkAddTypeMigration(): PendingMigration {
    return {
      number: 1,
      scriptPath: "/test/migrations/0001/migrate.ts",
      diffPath: "/test/migrations/0001/diff.json",
      hasScript: true,
      namespace: "test-ns",
      migrationsDir: "/test/migrations",
      diff: {
        version: 1,
        namespace: "test-ns",
        createdAt: new Date().toISOString(),
        changes: [{ kind: "table_added", tableName: "StockReservation" }],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  aroundEach(async (runTest) => {
    remoteCheckpoint.number = 0;
    remoteCheckpoint.historyId = null;
    vi.mocked(migrationModule.executeMigrations).mockClear();
    await runTest();
  });

  test("re-resolves an env static website placeholder before executing the migration script", async () => {
    const client = createMockClient();
    const planResult = buildPlanResult({ siteUrl: "my-site:url" });
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkAddTypeMigration()]);

    await applyTailorDB(client, planResult, "create-update");

    expect(client.getStaticWebsite).toHaveBeenCalledWith({
      workspaceId: "test-workspace",
      name: "my-site",
    });
    expect(migrationModule.executeMigrations).toHaveBeenCalledTimes(1);
    const [context] = vi.mocked(migrationModule.executeMigrations).mock.calls[0]!;
    expect(context.env).toEqual({ siteUrl: "https://my-site.tailor.tech" });
  });

  test("leaves env untouched, with no platform lookup, when it holds no placeholder", async () => {
    const client = createMockClient();
    const planResult = buildPlanResult({ plain: "value" });
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkAddTypeMigration()]);

    await applyTailorDB(client, planResult, "create-update");

    expect(client.getStaticWebsite).not.toHaveBeenCalled();
    const [context] = vi.mocked(migrationModule.executeMigrations).mock.calls[0]!;
    expect(context.env).toEqual({ plain: "value" });
  });
});
