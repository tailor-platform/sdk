/**
 * When some namespace has pending migrations, the whole apply takes the
 * migration flow — but that flow must not drop changes planned for OTHER
 * namespaces that have no pending migration (e.g. a fresh deploy where the
 * main namespace runs its baseline migration while a second namespace has
 * plain types to create).
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { applyTailorDB, captureMigrationFileState } from "./index";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { Application } from "#/cli/services/application";
import type { TailorDBService } from "#/cli/services/tailordb/service";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";

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
    updateMigrationLabel: vi.fn().mockResolvedValue(undefined),
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

vi.mock("#/cli/commands/tailordb/migrate/snapshot", async (importOriginal) => {
  const original =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    (await importOriginal()) as typeof import("#/cli/commands/tailordb/migrate/snapshot");
  return {
    ...original,
    assertValidMigrationFiles: vi.fn(),
    reconstructSnapshotFromMigrations: vi.fn().mockReturnValue({
      version: 1,
      namespace: "test-ns",
      createdAt: "2026-01-01T00:00:00.000Z",
      types: {
        User: {
          name: "User",
          pluralForm: "users",
          fields: { name: { type: "string", required: true } },
        },
      },
    }),
  };
});

import * as migrationModule from "./migration";

const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

describe("migration flow: namespaces without pending migrations", () => {
  function createMockClient() {
    return {
      createTailorDBService: vi.fn().mockResolvedValue({}),
      setMetadata: vi.fn().mockResolvedValue({}),
      getMetadata: vi.fn().mockResolvedValue({ metadata: { labels: {} } }),
      createTailorDBType: vi.fn().mockResolvedValue({}),
      updateTailorDBType: vi.fn().mockResolvedValue({}),
      createTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      updateTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBType: vi.fn().mockResolvedValue({}),
      deleteTailorDBService: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  function typeRequest(namespaceName: string, typeName: string) {
    return {
      workspaceId: "test-workspace",
      namespaceName,
      tailordbType: {
        name: typeName,
        schema: {
          fields: { name: { type: "string", required: true } },
        },
      },
    };
  }

  function createMockPlanResult() {
    const migratedService = {
      namespace: "test-ns",
      loadTypes: vi.fn().mockResolvedValue({}),
      types: {},
    } as unknown as TailorDBService;
    const plainService = {
      namespace: "analytics-ns",
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
          creates: [
            {
              name: "Event",
              request: typeRequest("analytics-ns", "Event"),
              metaRequest: {
                trn: "trn:v1:workspace:test-workspace:tailordb:analytics-ns:type:Event",
                labels: { "sdk-name": "test-app" },
              },
            },
          ],
          updates: [
            {
              name: "Session",
              request: typeRequest("analytics-ns", "Session"),
              metaRequest: {
                trn: "trn:v1:workspace:test-workspace:tailordb:analytics-ns:type:Session",
                labels: { "sdk-name": "test-app" },
              },
            },
          ],
          deletes: [
            {
              name: "Legacy",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "analytics-ns",
                tailordbTypeName: "Legacy",
              },
            },
          ],
          unchanged: [],
          title: "TailorDB Types",
          isEmpty: () => false,
          lines: () => [],
        },
        gqlPermission: {
          creates: [
            {
              name: "Event",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "analytics-ns",
                typeName: "Event",
                permission: {},
              },
            },
          ],
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
          tailorDBServices: [migratedService, plainService],
          authService: undefined,
        } as unknown as Application,
        tailorDBInputs: [],
        executorUsedTypes: new Set<string>(),
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

  function mkPendingMigration(): PendingMigration {
    return {
      number: 0,
      scriptPath: "/test/migrations/0000/migrate.ts",
      diffPath: "/test/migrations/0000/diff.json",
      namespace: "test-ns",
      migrationsDir: "/test/migrations",
      hasScript: false,
      diff: {
        version: 1,
        namespace: "test-ns",
        createdAt: "2026-01-01T00:00:00.000Z",
        changes: [
          {
            kind: "type_added",
            typeName: "User",
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("applies type and gqlPermission changes of a namespace without pending migrations", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration()]);

    await applyTailorDB(client, planResult, "create-update");

    const createdTypes = vi.mocked(client.createTailorDBType).mock.calls.map((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const request = call[0] as any;
      return `${request.namespaceName}/${request.tailordbType?.name}`;
    });
    expect(createdTypes).toContain("analytics-ns/Event");

    const updatedTypes = vi.mocked(client.updateTailorDBType).mock.calls.map((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const request = call[0] as any;
      return `${request.namespaceName}/${request.tailordbType?.name}`;
    });
    expect(updatedTypes).toContain("analytics-ns/Session");

    const createdPermissions = vi
      .mocked(client.createTailorDBGQLPermission)
      .mock.calls.map((call) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const request = call[0] as any;
        return `${request.namespaceName}/${request.typeName}`;
      });
    expect(createdPermissions).toContain("analytics-ns/Event");

    const deletedTypes = vi.mocked(client.deleteTailorDBType).mock.calls.map((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const request = call[0] as any;
      return `${request.namespaceName}/${request.tailordbTypeName}`;
    });
    expect(deletedTypes).toContain("analytics-ns/Legacy");
  });
  test("writes the metadata of types planned alongside a migration", async () => {
    // The migration flow applies types through its own phases, so it has to write
    // their metadata itself. Leaving it to the non-migration branch would skip a
    // cross-config dependency record on any deploy that carries a migration, and
    // the owner's next solo deploy would turn publishing off without asking.
    const client = createMockClient();
    const planResult = createMockPlanResult();

    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration()]);

    await applyTailorDB(client, planResult, "create-update");

    const trns = vi.mocked(client.setMetadata).mock.calls.map((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (call[0] as any).trn as string;
    });
    expect(trns).toContain("trn:v1:workspace:test-workspace:tailordb:analytics-ns:type:Event");
    expect(trns).toContain("trn:v1:workspace:test-workspace:tailordb:analytics-ns:type:Session");
  });
});
