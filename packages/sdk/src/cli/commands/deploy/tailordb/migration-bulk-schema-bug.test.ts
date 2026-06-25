/**
 * Per-migration prePhase must submit the schema state as of that migration,
 * not the FINAL (post-all-migrations) schema. Removals declared in migration
 * M must not leak into the prePhase of any earlier migration N (N < M);
 * deletions are owned by M's postPhase only.
 *
 * See `services/tailordb-migration.md` §"Per-migration phases".
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { applyTailorDB } from "./index";
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
    buildMetaRequest: vi.fn().mockResolvedValue({
      trn: "trn:v1:workspace:test-workspace:tailordb:test-ns",
      labels: {},
    }),
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

const snapshotFixtures = vi.hoisted(() => {
  const buildUser = (
    fields: Record<string, { type: string; required: boolean; array?: boolean }>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any => ({
    name: "User",
    pluralForm: "users",
    fields,
  });

  const userAfterMigration1 = buildUser({
    name: { type: "string", required: true },
    permissions: { type: "string", required: false, array: true },
    roles: { type: "string", required: true, array: true },
  });

  const userAfterMigration5 = buildUser({
    name: { type: "string", required: true },
    permissions: { type: "string", required: false, array: true },
  });

  const baseSnapshot =
    (typesByMigration: Record<number, unknown>) => (migrationsDir: string, maxVersion?: number) => {
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
    };

  return {
    reconstructSnapshotFromMigrations: baseSnapshot({
      1: { User: userAfterMigration1 },
      5: { User: userAfterMigration5 },
    }),
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

describe("per-migration prePhase: schema is scoped to migration[N]", () => {
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

    const finalUserTypeRequest = {
      workspaceId: "test-workspace",
      namespaceName: "test-ns",
      tailordbType: {
        name: "User",
        schema: {
          fields: [
            { name: "id", type: "uuid", required: true },
            { name: "name", type: "string", required: true },
            { name: "permissions", type: "string", required: false, array: true },
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
          lines: () => [],
        },
        type: {
          creates: [],
          updates: [
            {
              name: "User",
              request: finalUserTypeRequest,
            },
          ],
          deletes: [],
          title: "TailorDB Types",
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
            after: { type: "string", required: false, array: true },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  function mkRemoveFieldMigration(
    number: number,
    typeName: string,
    fieldName: string,
  ): PendingMigration {
    return {
      number,
      scriptPath: `/test/migrations/${String(number).padStart(4, "0")}/migrate.ts`,
      diffPath: `/test/migrations/${String(number).padStart(4, "0")}/diff.json`,
      namespace: "test-ns",
      migrationsDir: "/test/migrations",
      diff: {
        version: 1,
        namespace: "test-ns",
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_removed",
            typeName,
            fieldName,
            before: { type: "string", required: true, array: true },
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

  test("per-migration semantics: migration #1 prePhase must NOT apply removals declared in later migration #5", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkAddFieldMigration(1, "User", "permissions"),
      mkRemoveFieldMigration(5, "User", "roles"),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const updateCalls = vi.mocked(client.updateTailorDBType).mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    const firstCall = updateCalls[0];
    expect(firstCall).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sentSchema = (firstCall![0] as any)?.tailordbType?.schema;
    expect(sentSchema).toBeDefined();

    // `fields` is a Record keyed by field name (id is implicit and excluded).
    const fieldNames = Object.keys(sentSchema.fields ?? {});

    expect(fieldNames).toContain("permissions");
    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("roles");
  });

  test("verification: only User-affecting migrations trigger updateTailorDBType for User", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkAddFieldMigration(1, "SomeOtherType", "foo"),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const updateCalls = vi.mocked(client.updateTailorDBType).mock.calls;
    const userUpdates = updateCalls.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c) => (c[0] as any)?.tailordbType?.name === "User",
    );
    expect(userUpdates).toHaveLength(0);
  });
});
