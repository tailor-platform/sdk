import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test, vi, beforeEach, afterAll } from "vitest";
import {
  SCHEMA_SNAPSHOT_VERSION,
  type MigrationDiff,
} from "#/cli/commands/tailordb/migrate/diff-calculator";
import {
  formatMigrationNumber,
  DIFF_FILE_NAME,
  MIGRATE_FILE_NAME,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { MIGRATION_LABEL_KEY } from "#/cli/commands/tailordb/migrate/types";
import {
  detectPendingMigrations,
  updateMigrationLabel,
  getMigrationMachineUser,
  groupMigrationsByNamespace,
  executeMigrations,
  type MigrationContext,
} from "./migration";
import type { NamespaceWithMigrations } from "#/cli/commands/tailordb/migrate/config";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { OperatorClient } from "#/cli/shared/client";

// Mock label.ts for resourceTrn
vi.mock("../label", () => ({
  resourceTrn: (workspaceId: string, kind: string, name: string) =>
    `trn:v1:workspace:${workspaceId}:${kind}:${name}`,
}));

// Mock logger to suppress output during tests
vi.mock("#/cli/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    newline: vi.fn(),
    log: vi.fn(),
  },
  styles: {
    bold: (s: string) => s,
  },
}));

// Mock spinner so tests don't render TTY frames
vi.mock("#/cli/shared/spinner", () => ({
  spinner: () => ({
    start: () => ({
      succeed: vi.fn(),
      fail: vi.fn(),
    }),
  }),
}));

// Mock bundler and script executor so executeMigrations can run without
// touching the network or building real bundles.
const bundleMigrationScriptMock = vi.fn();
const executeScriptMock = vi.fn();
vi.mock("#/cli/commands/tailordb/migrate/bundler", () => ({
  bundleMigrationScript: (...args: unknown[]) => bundleMigrationScriptMock(...args),
}));
vi.mock("#/cli/shared/script-executor", () => ({
  executeScript: (...args: unknown[]) => executeScriptMock(...args),
}));

const TEST_MIGRATIONS_BASE = path.join(__dirname, "__test_migrations_service__");

function createMockDiff(options: Partial<MigrationDiff> = {}): MigrationDiff {
  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: "tailordb",
    createdAt: new Date().toISOString(),
    changes: [],
    hasBreakingChanges: false,
    breakingChanges: [],
    hasWarnings: false,
    warnings: [],
    requiresMigrationScript: false,
    ...options,
  };
}

function createMockMigration(overrides: Partial<PendingMigration> = {}): PendingMigration {
  return {
    number: 1,
    scriptPath: "/path/0001/migrate.ts",
    hasScript: true,
    diffPath: "/path/0001/diff.json",
    namespace: "tailordb",
    migrationsDir: "/path",
    diff: createMockDiff(),
    ...overrides,
  };
}

function makeTestDir(prefix: string): string {
  const dir = path.join(
    TEST_MIGRATIONS_BASE,
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeDiffFile(baseDir: string, migrationNumber: number, diff: MigrationDiff): void {
  const migDir = path.join(baseDir, formatMigrationNumber(migrationNumber));
  fs.mkdirSync(migDir, { recursive: true });
  fs.writeFileSync(path.join(migDir, DIFF_FILE_NAME), JSON.stringify(diff, null, 2));
}

function writeMigrateFile(baseDir: string, migrationNumber: number, content = ""): void {
  const migDir = path.join(baseDir, formatMigrationNumber(migrationNumber));
  fs.mkdirSync(migDir, { recursive: true });
  fs.writeFileSync(path.join(migDir, MIGRATE_FILE_NAME), content);
}

function writeSchemaFile(baseDir: string, migrationNumber: number): void {
  const migDir = path.join(baseDir, formatMigrationNumber(migrationNumber));
  fs.mkdirSync(migDir, { recursive: true });
  fs.writeFileSync(
    path.join(migDir, "schema.json"),
    JSON.stringify({
      version: SCHEMA_SNAPSHOT_VERSION,
      namespace: "tailordb",
      createdAt: new Date().toISOString(),
      types: {},
    }),
  );
}

function createMetadataClient(
  metadata: { labels: Record<string, string> } | null,
  setMetadataMock: ReturnType<typeof vi.fn>,
): OperatorClient {
  return {
    getMetadata: vi.fn().mockResolvedValue({ metadata }),
    setMetadata: setMetadataMock,
  } as unknown as OperatorClient;
}

describe("migration", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir("test");
  });

  afterAll(() => {
    try {
      fs.rmSync(TEST_MIGRATIONS_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ==========================================================================
  // getMigrationMachineUser
  // ==========================================================================
  describe("getMigrationMachineUser", () => {
    test.each<
      [
        name: string,
        config: { machineUser?: string } | undefined,
        machineUsers: string[] | undefined,
        expected: string | undefined,
      ]
    >([
      [
        "returns explicit machineUser from config",
        { machineUser: "explicit-user" },
        ["fallback-user"],
        "explicit-user",
      ],
      [
        "falls back to first machine user from auth",
        undefined,
        ["first-user", "second-user"],
        "first-user",
      ],
      [
        "falls back to first machine user when config has no machineUser",
        {},
        ["first-user", "second-user"],
        "first-user",
      ],
      ["returns undefined when no machine users available", undefined, undefined, undefined],
      ["returns undefined when machine users array is empty", undefined, [], undefined],
    ])("%s", (_name, config, machineUsers, expected) => {
      expect(getMigrationMachineUser(config, machineUsers)).toBe(expected);
    });
  });

  // ==========================================================================
  // groupMigrationsByNamespace
  // ==========================================================================
  describe("groupMigrationsByNamespace", () => {
    test("groups migrations by namespace", () => {
      const migrations = [
        createMockMigration({ namespace: "namespace-a", number: 1 }),
        createMockMigration({ namespace: "namespace-b", number: 1 }),
        createMockMigration({ namespace: "namespace-a", number: 2 }),
      ];

      const result = groupMigrationsByNamespace(migrations);

      expect(result.size).toBe(2);
      expect(result.get("namespace-a")).toHaveLength(2);
      expect(result.get("namespace-b")).toHaveLength(1);
      expect(result.get("namespace-a")![0]!.number).toBe(1);
      expect(result.get("namespace-a")![1]!.number).toBe(2);
    });

    test("returns empty map for empty input", () => {
      const result = groupMigrationsByNamespace([]);
      expect(result.size).toBe(0);
    });

    test("handles single namespace", () => {
      const migrations = [
        createMockMigration({ namespace: "single", number: 1 }),
        createMockMigration({ namespace: "single", number: 2 }),
      ];

      const result = groupMigrationsByNamespace(migrations);

      expect(result.size).toBe(1);
      expect(result.get("single")).toHaveLength(2);
    });
  });

  // ==========================================================================
  // detectPendingMigrations
  // ==========================================================================
  describe("detectPendingMigrations", () => {
    const workspaceId = "test-workspace";

    function createMockClient(currentMigrations: Record<string, number>): OperatorClient {
      return {
        getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
          const namespace = trn.split(":").pop();
          const migrationNumber = namespace ? currentMigrations[namespace] : undefined;
          return {
            metadata: {
              labels:
                migrationNumber !== undefined
                  ? { [MIGRATION_LABEL_KEY]: `m${formatMigrationNumber(migrationNumber)}` }
                  : {},
            },
          };
        }),
      } as unknown as OperatorClient;
    }

    test("returns empty array when no pending migrations", async () => {
      const client = createMockClient({ tailordb: 1 });
      writeDiffFile(testDir, 1, createMockDiff());

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);
      expect(result).toHaveLength(0);
    });

    test("detects single pending migration", async () => {
      const client = createMockClient({ tailordb: 0 });
      writeDiffFile(testDir, 1, createMockDiff());

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);

      expect(result).toHaveLength(1);
      expect(result[0]!.number).toBe(1);
      expect(result[0]!.namespace).toBe("tailordb");
    });

    test("detects multiple pending migrations", async () => {
      const client = createMockClient({ tailordb: 1 });
      writeDiffFile(testDir, 2, createMockDiff());
      writeDiffFile(testDir, 3, createMockDiff());

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);

      expect(result).toHaveLength(2);
      expect(result[0]!.number).toBe(2);
      expect(result[1]!.number).toBe(3);
    });

    test("skips migrations without diff file", async () => {
      const client = createMockClient({ tailordb: 0 });

      // Create migration directory without diff file
      const migDir = path.join(testDir, formatMigrationNumber(1));
      fs.mkdirSync(migDir, { recursive: true });
      // Only write schema.json, no diff.json
      writeSchemaFile(testDir, 0);

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);
      expect(result).toHaveLength(0);
    });

    test("warns when breaking change migration missing script", async () => {
      const { logger } = await import("#/cli/shared/logger");
      const client = createMockClient({ tailordb: 0 });

      // Create migration with breaking change but no script (no migrate.ts file)
      writeDiffFile(
        testDir,
        1,
        createMockDiff({ hasBreakingChanges: true, requiresMigrationScript: true }),
      );

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);

      expect(result).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("requires a script but migrate.ts not found"),
      );
    });

    test("includes breaking change migration with script", async () => {
      const client = createMockClient({ tailordb: 0 });

      writeDiffFile(
        testDir,
        1,
        createMockDiff({ hasBreakingChanges: true, requiresMigrationScript: true }),
      );
      writeMigrateFile(testDir, 1, "export async function main() {}");

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);

      expect(result).toHaveLength(1);
      expect(result[0]!.diff.requiresMigrationScript).toBe(true);
    });

    test("sorts migrations by namespace and number", async () => {
      const testDir2 = makeTestDir("test2");
      const client = createMockClient({ "namespace-a": 0, "namespace-b": 0 });

      // Create migrations in different order
      writeDiffFile(testDir2, 2, createMockDiff({ namespace: "namespace-b" }));
      writeDiffFile(testDir, 1, createMockDiff({ namespace: "namespace-a" }));
      writeDiffFile(testDir2, 1, createMockDiff({ namespace: "namespace-b" }));
      writeDiffFile(testDir, 2, createMockDiff({ namespace: "namespace-a" }));

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "namespace-b", migrationsDir: testDir2 },
        { namespace: "namespace-a", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);

      // Should be sorted by namespace first, then by number
      expect(result).toHaveLength(4);
      expect(result.map((m) => [m.namespace, m.number])).toEqual([
        ["namespace-a", 1],
        ["namespace-a", 2],
        ["namespace-b", 1],
        ["namespace-b", 2],
      ]);
    });
  });

  // ==========================================================================
  // updateMigrationLabel
  // ==========================================================================
  describe("updateMigrationLabel", () => {
    const workspaceId = "test-workspace";
    const namespace = "tailordb";
    const expectedTrn = `trn:v1:workspace:${workspaceId}:tailordb:${namespace}`;

    test("updates migration label on service metadata", async () => {
      const setMetadataMock = vi.fn();
      const client = createMetadataClient({ labels: {} }, setMetadataMock);

      await updateMigrationLabel(client, workspaceId, namespace, 5);

      expect(setMetadataMock).toHaveBeenCalledWith({
        trn: expectedTrn,
        labels: { [MIGRATION_LABEL_KEY]: "m0005" },
      });
    });

    test("preserves existing labels", async () => {
      const setMetadataMock = vi.fn();
      const client = createMetadataClient(
        { labels: { "existing-label": "value", "another-label": "another-value" } },
        setMetadataMock,
      );

      await updateMigrationLabel(client, workspaceId, namespace, 3);

      expect(setMetadataMock).toHaveBeenCalledWith({
        trn: expectedTrn,
        labels: {
          "existing-label": "value",
          "another-label": "another-value",
          [MIGRATION_LABEL_KEY]: "m0003",
        },
      });
    });

    test("handles missing metadata gracefully", async () => {
      const setMetadataMock = vi.fn();
      const client = createMetadataClient(null, setMetadataMock);

      await updateMigrationLabel(client, workspaceId, namespace, 1);

      expect(setMetadataMock).toHaveBeenCalledWith({
        trn: expectedTrn,
        labels: { [MIGRATION_LABEL_KEY]: "m0001" },
      });
    });
  });

  // ==========================================================================
  // executeMigrations
  // ==========================================================================
  describe("executeMigrations", () => {
    const workspaceId = "test-workspace";

    function createMockContext(): MigrationContext {
      return {
        client: {} as unknown as OperatorClient,
        workspaceId,
        authNamespace: "auth",
        machineUsers: ["test-machine-user"],
        dbConfig: {},
        env: {},
      };
    }

    beforeEach(() => {
      bundleMigrationScriptMock.mockReset();
      executeScriptMock.mockReset();
      bundleMigrationScriptMock.mockResolvedValue({
        bundledCode: "// bundled",
        warnings: [],
      });
      executeScriptMock.mockResolvedValue({
        success: true,
        logs: "",
        result: "",
      });
    });

    test("skips migrations without a script file on disk", async () => {
      const migrations = [
        createMockMigration({ number: 1, hasScript: false }),
        createMockMigration({ number: 2, hasScript: false }),
      ];

      await executeMigrations(createMockContext(), migrations);

      expect(bundleMigrationScriptMock).not.toHaveBeenCalled();
      expect(executeScriptMock).not.toHaveBeenCalled();
    });

    test("executes warning-tier migrations whose script exists even when not required", async () => {
      // requiresMigrationScript=false but hasScript=true represents the
      // warning-tier case (e.g. field_removed) where the user opted in by
      // running `tailordb migration script`. The optional script must still
      // run during deploy.
      const migrations = [
        createMockMigration({
          number: 1,
          hasScript: true,
          diff: createMockDiff({ hasWarnings: true, requiresMigrationScript: false }),
        }),
        createMockMigration({
          number: 2,
          hasScript: false,
          diff: createMockDiff({ hasWarnings: true, requiresMigrationScript: false }),
        }),
      ];

      await executeMigrations(createMockContext(), migrations);

      expect(bundleMigrationScriptMock).toHaveBeenCalledTimes(1);
      expect(executeScriptMock).toHaveBeenCalledTimes(1);
      expect(executeScriptMock.mock.calls[0]![0]).toMatchObject({
        name: "migration-tailordb-0001.js",
      });
    });

    test("executes only the subset with hasScript=true when mixed with breaking changes", async () => {
      const migrations = [
        createMockMigration({
          number: 1,
          hasScript: true,
          diff: createMockDiff({ hasBreakingChanges: true, requiresMigrationScript: true }),
        }),
        createMockMigration({
          number: 2,
          hasScript: false,
          diff: createMockDiff({ hasWarnings: true, requiresMigrationScript: false }),
        }),
        createMockMigration({
          number: 3,
          hasScript: true,
          diff: createMockDiff({ hasWarnings: true, requiresMigrationScript: false }),
        }),
      ];

      await executeMigrations(createMockContext(), migrations);

      expect(executeScriptMock).toHaveBeenCalledTimes(2);
      const executedNames = executeScriptMock.mock.calls.map(
        (call) => (call[0] as { name: string }).name,
      );
      expect(executedNames).toEqual(["migration-tailordb-0001.js", "migration-tailordb-0003.js"]);
    });
  });
});
