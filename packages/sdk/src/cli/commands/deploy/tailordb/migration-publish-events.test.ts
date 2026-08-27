/**
 * A migrating namespace must not accept GraphQL mutations or publish record
 * events from a shape that executors and callers cannot safely use. The
 * restrictions have to remain in place until every migration has settled.
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

describe("migration flow: namespace restrictions while migrations run", () => {
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
    settings?: {
      publishEvents?: boolean;
      gqlOperations?: {
        create?: boolean;
        update?: boolean;
        delete?: boolean;
        read?: boolean;
      };
    },
  ) {
    return { name, pluralForm: `${name.toLowerCase()}s`, fields, ...(settings && { settings }) };
  }

  function typeCreate(tableName: string) {
    return {
      name: tableName,
      request: {
        workspaceId: "test-workspace",
        namespaceName: "test-ns",
        tailordbType: {
          name: tableName,
          schema: {
            fields: { name: { type: "string", required: true } },
          },
        },
      },
      metaRequest: {
        trn: `trn:v1:workspace:test-workspace:tailordb:test-ns:type:${tableName}`,
        labels: { "sdk-name": "test-app" },
      },
    };
  }

  function createMockPlanResult(options: {
    creates: string[];
    updates?: string[];
    gqlPermissionTypes?: string[];
    /** Tables an enabled executor subscribes to, so publishing is on for them. */
    subscribedTables?: string[];
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
          creates: (options.gqlPermissionTypes ?? []).map((tableName) => ({
            name: tableName,
            request: {
              workspaceId: "test-workspace",
              namespaceName: "test-ns",
              typeName: tableName,
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

  type WrittenSettings = {
    publishRecordEvents?: boolean;
    disableGqlOperations?: {
      create?: boolean;
      update?: boolean;
      delete?: boolean;
      read?: boolean;
    };
  };

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

  beforeEach(() => {
    vi.clearAllMocks();
    snapshotState.tablesByVersion = {};
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

  test("restores the surviving table when a migration renames it", async () => {
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
    expect(writes.at(-1)).toEqual(["Invoice", true]);
    expect(writes.map(([name]) => name)).not.toContain("Bill");
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

  test("makes the namespace read-only while a data-only migration runs", async () => {
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
    const client = createMockClient();
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
});
