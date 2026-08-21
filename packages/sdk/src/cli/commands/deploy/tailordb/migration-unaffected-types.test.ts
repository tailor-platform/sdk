/**
 * Within a migrating namespace, the per-migration phases only materialize
 * types named by some pending diff (plus types whose GQL permission forces a
 * fallback create). Planned creates of types that already exist in the schema
 * state before the namespace's first pending migration — the whole baseline
 * on a fresh-workspace replay, and every table when the pending migration is
 * data-only — must still be created, from that snapshot's schema, before any
 * migration script runs.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { applyTailorDB, captureMigrationFileState } from "./index";
import type { DiffChange } from "#/cli/commands/tailordb/migrate/diff-calculator";
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

// Per-test schema states keyed by migration number, so reconstruction returns
// the state as of the requested checkpoint like the real replay does.
const snapshotState = vi.hoisted(() => ({
  tablesByVersion: {} as Record<number, unknown>,
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
      };
    }),
  };
});

import * as migrationModule from "./migration";

const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

describe("migration flow: creates of types predating the pending migrations", () => {
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

  function snapshotTable(
    name: string,
    fields: Record<string, { type: string; required: boolean }>,
  ) {
    return { name, pluralForm: `${name.toLowerCase()}s`, fields };
  }

  function typeCreate(typeName: string) {
    return {
      name: typeName,
      request: {
        workspaceId: "test-workspace",
        namespaceName: "test-ns",
        tailordbType: {
          name: typeName,
          schema: {
            fields: { name: { type: "string", required: true } },
          },
        },
      },
      metaRequest: {
        trn: `trn:v1:workspace:test-workspace:tailordb:test-ns:type:${typeName}`,
        labels: { "sdk-name": "test-app" },
      },
    };
  }

  function createMockPlanResult(options: {
    creates: string[];
    updates?: string[];
    gqlPermissionTypes?: string[];
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
          creates: (options.gqlPermissionTypes ?? []).map((typeName) => ({
            name: typeName,
            request: {
              workspaceId: "test-workspace",
              namespaceName: "test-ns",
              typeName,
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

  function createdTypeCalls(client: OperatorClient) {
    return vi.mocked(client.createTailorDBType).mock.calls.map((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const request = call[0] as any;
      return `${request.namespaceName}/${request.tailordbType?.name}`;
    });
  }

  function createOrderOf(client: OperatorClient, typeName: string) {
    const index = vi
      .mocked(client.createTailorDBType)
      .mock.calls.findIndex(
        (call) => (call[0] as { tailordbType?: { name?: string } }).tailordbType?.name === typeName,
      );
    return vi.mocked(client.createTailorDBType).mock.invocationCallOrder[index];
  }

  function firstScriptOrder() {
    return vi.mocked(migrationModule.executeMigrations).mock.invocationCallOrder[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    snapshotState.tablesByVersion = {};
  });

  test("creates a baseline type no pending diff names, from its snapshot, before the script", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({
      creates: ["User", "Audit"],
      updates: ["Metrics"],
      gqlPermissionTypes: ["User"],
    });
    snapshotState.tablesByVersion = {
      0: { Audit: snapshotTable("Audit", { legacy: { type: "string", required: false } }) },
      1: {
        Audit: snapshotTable("Audit", { legacy: { type: "string", required: false } }),
        User: snapshotTable("User", { name: { type: "string", required: true } }),
      },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_added", tableName: "User" } as any]),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    expect(createdTypeCalls(client)).toContain("test-ns/Audit");
    expect(createOrderOf(client, "Audit")).toBeLessThan(firstScriptOrder()!);

    // The create is built from the checkpoint snapshot, not the final schema.
    const auditRequest = vi
      .mocked(client.createTailorDBType)
      .mock.calls.map(
        (call) => call[0] as { tailordbType?: { name?: string; schema?: { fields?: object } } },
      )
      .find((request) => request.tailordbType?.name === "Audit");
    expect(Object.keys(auditRequest?.tailordbType?.schema?.fields ?? {})).toContain("legacy");

    // Updates of types no pending diff names stay skipped: the final schema
    // must not be enforced outside the per-migration phases.
    const updatedTypes = vi.mocked(client.updateTailorDBType).mock.calls.map((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const request = call[0] as any;
      return `${request.namespaceName}/${request.tailordbType?.name}`;
    });
    expect(updatedTypes).not.toContain("test-ns/Metrics");
  });

  test("data-only migration: every baseline type is created exactly once before the script", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({
      creates: ["User", "Audit"],
      gqlPermissionTypes: ["User"],
    });
    const baseline = {
      User: snapshotTable("User", { name: { type: "string", required: true } }),
      Audit: snapshotTable("Audit", { legacy: { type: "string", required: false } }),
    };
    snapshotState.tablesByVersion = { 0: baseline, 1: baseline };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration([])]);

    await applyTailorDB(client, planResult, "create-update");

    const created = createdTypeCalls(client);
    expect(created).toContain("test-ns/Audit");
    expect(created.filter((name) => name === "test-ns/User")).toHaveLength(1);

    const lastCreateOrder = Math.max(
      ...vi.mocked(client.createTailorDBType).mock.invocationCallOrder,
    );
    expect(lastCreateOrder).toBeLessThan(firstScriptOrder()!);
  });

  test("creates a baseline type a later migration modifies before the earlier script", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({ creates: ["User"] });
    const baselineUser = snapshotTable("User", { name: { type: "string", required: true } });
    snapshotState.tablesByVersion = {
      0: { User: baselineUser },
      1: { User: baselineUser },
      2: {
        User: snapshotTable("User", {
          name: { type: "string", required: true },
          nickname: { type: "string", required: false },
        }),
      },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([]),
      mkPendingMigration(
        [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {
            kind: "field_added",
            tableName: "User",
            fieldName: "nickname",
            after: { type: "string", required: false },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ],
        { number: 2, hasScript: false },
      ),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const created = createdTypeCalls(client);
    expect(created.filter((name) => name === "test-ns/User")).toHaveLength(1);
    expect(createOrderOf(client, "User")).toBeLessThan(firstScriptOrder()!);
  });

  test("does not pre-create a type that a later pending migration adds", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({ creates: ["Report", "Audit"] });
    const audit = snapshotTable("Audit", { legacy: { type: "string", required: false } });
    snapshotState.tablesByVersion = {
      0: { Audit: audit },
      1: { Audit: audit },
      2: {
        Audit: audit,
        Report: snapshotTable("Report", { name: { type: "string", required: true } }),
      },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_added", tableName: "Report" } as any], {
        number: 2,
        hasScript: false,
      }),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const created = createdTypeCalls(client);
    expect(created.filter((name) => name === "test-ns/Report")).toHaveLength(1);
    expect(created).toContain("test-ns/Audit");
    expect(createOrderOf(client, "Report")).toBeGreaterThan(firstScriptOrder()!);
    expect(createOrderOf(client, "Audit")).toBeLessThan(firstScriptOrder()!);
  });

  test("does not pre-create a baseline type a pending migration removes and re-adds", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult({ creates: ["Draft", "Audit"] });
    const audit = snapshotTable("Audit", { legacy: { type: "string", required: false } });
    const draft = snapshotTable("Draft", { name: { type: "string", required: true } });
    snapshotState.tablesByVersion = {
      0: { Audit: audit, Draft: draft },
      1: { Audit: audit, Draft: draft },
      2: { Audit: audit },
      3: { Audit: audit, Draft: draft },
    };
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkPendingMigration([]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_removed", tableName: "Draft" } as any], {
        number: 2,
        hasScript: false,
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_added", tableName: "Draft" } as any], {
        number: 3,
        hasScript: false,
      }),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    // Pre-creating Draft would erase the remove→add boundary: with no delete
    // entry in the plan, the removal's post phase would drop nothing and rows
    // written before the removal would survive it.
    const created = createdTypeCalls(client);
    expect(created.filter((name) => name === "test-ns/Draft")).toHaveLength(1);
    expect(createOrderOf(client, "Draft")).toBeGreaterThan(firstScriptOrder()!);
    expect(createOrderOf(client, "Audit")).toBeLessThan(firstScriptOrder()!);
  });
});
