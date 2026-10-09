import * as fs from "node:fs";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import * as path from "pathe";
import { describe, expect, test, vi, aroundAll, aroundEach } from "vitest";
import {
  SCHEMA_SNAPSHOT_VERSION,
  type MigrationDiff,
} from "#/cli/commands/tailordb/migrate/diff-calculator";
import {
  formatMigrationNumber,
  DIFF_FILE_NAME,
  MIGRATE_FILE_NAME,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { createMockMigrationDiff } from "#/cli/commands/tailordb/migrate/test-helpers/migration-diff";
import {
  MIGRATION_HISTORY_LABEL_KEY,
  MIGRATION_IN_PROGRESS_LABEL_KEY,
  MIGRATION_LABEL_KEY,
} from "#/cli/commands/tailordb/migrate/types";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { withMetadataWriteBatch } from "../label";
import {
  detectPendingMigrations,
  updateMigrationLabel,
  getMigrationMachineUser,
  groupMigrationsByNamespace,
  executeMigrations,
  isMigrationPartiallyApplied,
  type MigrationContext,
} from "./migration";
import { MaintenanceTimeline } from "./migration-timing";
import type { NamespaceWithMigrations } from "#/cli/commands/tailordb/migrate/config";
import type { MigrationScriptForm } from "#/cli/commands/tailordb/migrate/script-form";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { OperatorClient } from "#/cli/shared/client";
import type { MigrationRunEvent } from "./migration-workflow";

// Mock label.ts for resourceTrn
vi.mock("../label", async (importOriginal) => ({
  ...(await importOriginal()),
  resourceTrn: (workspaceId: string, kind: string, name: string) =>
    `trn:v1:workspace:${workspaceId}:${kind}:${name}`,
}));

// Mock logger to suppress output during tests
vi.mock("#/cli/shared/logger", async (importOriginal) => ({
  ...(await importOriginal()),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    newline: vi.fn(),
    log: vi.fn(),
    verbose: false,
  },
  styles: {
    bold: (s: string) => s,
  },
}));

// Mock spinner so tests don't render TTY frames
const spinnerMock = vi.hoisted(() => ({
  succeed: vi.fn(),
  fail: vi.fn(),
  stop: vi.fn(),
  start: vi.fn(),
  text: "",
}));
vi.mock("#/cli/shared/spinner", () => ({
  spinner: () => ({ start: () => spinnerMock }),
}));

// Mock the bundler and the workflow executor so executeMigrations can run
// without touching the network or building real bundles.
const bundleMigrationScriptMock = vi.fn();
const bundleMigrationStepsMock = vi.fn(
  async (_options: { temporal?: boolean; dateDefault?: "legacy" | "temporal" }) => ({
    bundledCode: "// bundled steps",
  }),
);
vi.mock("#/cli/commands/tailordb/migrate/bundler", () => ({
  bundleMigrationScript: (...args: unknown[]) => bundleMigrationScriptMock(...args),
  bundleMigrationSteps: (options: { temporal?: boolean; dateDefault?: "legacy" | "temporal" }) =>
    bundleMigrationStepsMock(options),
}));
const executeMigrationAsWorkflowMock = vi.fn();
const executeMigrationStepsAsWorkflowMock = vi.fn();
vi.mock("./migration-workflow", () => ({
  executeMigrationAsWorkflow: (...args: unknown[]) => executeMigrationAsWorkflowMock(...args),
  executeMigrationStepsAsWorkflow: (...args: unknown[]) =>
    executeMigrationStepsAsWorkflowMock(...args),
  migrationStepRunnerName: (name: string) => `${name}--step`,
  migrationWorkflowResourceName: (namespace: string, number: number) =>
    `tailordb-migration--${namespace}--${number}`,
}));

const TEST_MIGRATIONS_BASE = path.join(__dirname, "__test_migrations_service__");

function createMockMigration(overrides: Partial<PendingMigration> = {}): PendingMigration {
  return {
    number: 1,
    scriptPath: "/path/0001/migrate.ts",
    hasScript: true,
    scriptForm: { kind: "main" },
    diffPath: "/path/0001/diff.json",
    namespace: "tailordb",
    migrationsDir: "/path",
    diff: createMockMigrationDiff(),
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

  aroundEach(async (runTest) => {
    testDir = makeTestDir("test");
    await runTest();
  });

  aroundAll(async (runSuite) => {
    await runSuite();
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
      writeDiffFile(testDir, 1, createMockMigrationDiff());

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);
      expect(result).toHaveLength(0);
    });

    test("treats a missing remote namespace as migration 0", async () => {
      const client = {
        getMetadata: vi.fn().mockRejectedValue(new ConnectError("not found", Code.NotFound)),
      } as unknown as OperatorClient;
      writeDiffFile(testDir, 1, createMockMigrationDiff());

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);

      expect(result.map((migration) => migration.number)).toEqual([1]);
    });

    test.each([
      ["unavailable", new ConnectError("unavailable", Code.Unavailable)],
      ["permission denied", new ConnectError("permission denied", Code.PermissionDenied)],
    ])("propagates %s errors while reading the migration checkpoint", async (_name, error) => {
      const client = {
        getMetadata: vi.fn().mockRejectedValue(error),
      } as unknown as OperatorClient;
      writeDiffFile(testDir, 1, createMockMigrationDiff());

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      await expect(
        detectPendingMigrations(client, workspaceId, namespacesWithMigrations),
      ).rejects.toBe(error);
    });

    test("detects single pending migration", async () => {
      const client = createMockClient({ tailordb: 0 });
      writeDiffFile(testDir, 1, createMockMigrationDiff());

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);

      expect(result).toHaveLength(1);
      expect(result[0]!.number).toBe(1);
      expect(result[0]!.namespace).toBe("tailordb");
    });

    test("uses an approved checkpoint override without reading remote metadata", async () => {
      const client = createMockClient({ tailordb: 5 });
      writeDiffFile(testDir, 1, createMockMigrationDiff());
      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(
        client,
        workspaceId,
        namespacesWithMigrations,
        undefined,
        new Map([["tailordb", 0]]),
      );

      expect(result.map((migration) => migration.number)).toEqual([1]);
      expect(client.getMetadata).not.toHaveBeenCalled();
    });

    test("detects multiple pending migrations", async () => {
      const client = createMockClient({ tailordb: 1 });
      writeDiffFile(testDir, 2, createMockMigrationDiff());
      writeDiffFile(testDir, 3, createMockMigrationDiff());

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

    test("throws when breaking change migration missing script", async () => {
      const client = createMockClient({ tailordb: 0 });

      // Create migration with breaking change but no script (no migrate.ts file)
      writeDiffFile(
        testDir,
        1,
        createMockMigrationDiff({ hasBreakingChanges: true, requiresMigrationScript: true }),
      );

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      await expect(
        detectPendingMigrations(client, workspaceId, namespacesWithMigrations),
      ).rejects.toThrow(/requires a migration script but migrate\.ts was not found/);
    });

    test("error for missing script mentions both resolution paths", async () => {
      const client = createMockClient({ tailordb: 0 });

      writeDiffFile(
        testDir,
        1,
        createMockMigrationDiff({ hasBreakingChanges: true, requiresMigrationScript: true }),
      );

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const error = await detectPendingMigrations(
        client,
        workspaceId,
        namespacesWithMigrations,
        path.join(process.cwd(), "custom", "tailor.config.ts"),
      ).then(
        () => null,
        (e: unknown) => e as Error,
      );

      expect(error).toMatchObject({ code: "MIGRATION_SCRIPT_REQUIRED" });
      const { suggestion } = error as CLIError;
      expect(suggestion).toContain("tailordb migration script 0001 --namespace tailordb");
      expect(suggestion).toContain("--no-script --reason '<reason>'");
      expect(suggestion).toContain(`--config=${path.join("custom", "tailor.config.ts")}`);
    });

    test("omits --config from the hint for the default config path", async () => {
      const client = createMockClient({ tailordb: 0 });

      writeDiffFile(
        testDir,
        1,
        createMockMigrationDiff({ hasBreakingChanges: true, requiresMigrationScript: true }),
      );

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const error = await detectPendingMigrations(
        client,
        workspaceId,
        namespacesWithMigrations,
        path.join(process.cwd(), "tailor.config.ts"),
      ).then(
        () => null,
        (e: unknown) => e as Error,
      );

      expect(error).toMatchObject({ code: "MIGRATION_SCRIPT_REQUIRED" });
      const { suggestion } = error as CLIError;
      expect(suggestion).toContain("tailordb migration script 0001 --namespace tailordb");
      expect(suggestion).not.toContain("--config");
    });

    test("throws before returning later migrations when a script is missing", async () => {
      const client = createMockClient({ tailordb: 0 });

      writeDiffFile(
        testDir,
        1,
        createMockMigrationDiff({ hasBreakingChanges: true, requiresMigrationScript: true }),
      );
      writeDiffFile(testDir, 2, createMockMigrationDiff());

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      await expect(
        detectPendingMigrations(client, workspaceId, namespacesWithMigrations),
      ).rejects.toThrow(/requires a migration script/);
    });

    test("includes migration when script skip is acknowledged", async () => {
      const { logger } = await import("#/cli/shared/logger");
      const client = createMockClient({ tailordb: 0 });

      writeDiffFile(
        testDir,
        1,
        createMockMigrationDiff({
          hasBreakingChanges: true,
          requiresMigrationScript: true,
          scriptSkipped: { reason: "no data yet", acknowledgedAt: "2026-07-22T00:00:00.000Z" },
        }),
      );

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);

      expect(result).toHaveLength(1);
      expect(result[0]!.hasScript).toBe(false);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("no data yet"));
    });

    test("throws when a migration has both a script skip acknowledgment and migrate.ts", async () => {
      const client = createMockClient({ tailordb: 0 });

      writeDiffFile(
        testDir,
        1,
        createMockMigrationDiff({
          hasBreakingChanges: true,
          requiresMigrationScript: true,
          scriptSkipped: { reason: "no data yet", acknowledgedAt: "2026-07-22T00:00:00.000Z" },
        }),
      );
      writeMigrateFile(testDir, 1, "export async function main() {}");

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const error = await detectPendingMigrations(
        client,
        workspaceId,
        namespacesWithMigrations,
      ).then(
        () => null,
        (e: unknown) => e as Error,
      );

      expect(error).toMatchObject({ code: "MIGRATION_SCRIPT_SKIP_CONFLICT" });
      expect(error!.message).toContain("has both a --no-script skip acknowledgment and migrate.ts");
      const { suggestion } = error as CLIError;
      expect(suggestion?.split("\n")).toContain(
        "Keep the script and clear the stale acknowledgment: `tailor tailordb migration script 0001 --namespace tailordb`",
      );
      expect(suggestion).toContain("delete migrate.ts");
    });

    test("runs main and warns when migrate.ts also exports steps", async () => {
      const client = createMockClient({ tailordb: 0 });
      writeDiffFile(testDir, 1, createMockMigrationDiff({ requiresMigrationScript: true }));
      writeMigrateFile(
        testDir,
        1,
        "export async function main() {}\nexport const steps = { backfill: { run: async () => {} } };",
      );
      vi.mocked(logger.warn).mockClear();

      const result = await detectPendingMigrations(client, workspaceId, [
        { namespace: "tailordb", migrationsDir: testDir },
      ]);

      expect(result[0]!.scriptForm).toEqual({ kind: "main", ignoredSteps: true });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "Migration tailordb/0001: migrate.ts exports `steps` next to `main`",
        ),
      );
    });

    test("includes breaking change migration with script", async () => {
      const client = createMockClient({ tailordb: 0 });

      writeDiffFile(
        testDir,
        1,
        createMockMigrationDiff({ hasBreakingChanges: true, requiresMigrationScript: true }),
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
      writeDiffFile(testDir2, 2, createMockMigrationDiff({ namespace: "namespace-b" }));
      writeDiffFile(testDir, 1, createMockMigrationDiff({ namespace: "namespace-a" }));
      writeDiffFile(testDir2, 1, createMockMigrationDiff({ namespace: "namespace-b" }));
      writeDiffFile(testDir, 2, createMockMigrationDiff({ namespace: "namespace-a" }));

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

    test("updates the migration checkpoint and history ID atomically", async () => {
      const setMetadataMock = vi.fn();
      const client = createMetadataClient(
        { labels: { "existing-label": "value" } },
        setMetadataMock,
      );

      await updateMigrationLabel(client, workspaceId, namespace, 0, "hcurrent");

      expect(setMetadataMock).toHaveBeenCalledWith({
        trn: expectedTrn,
        labels: {
          "existing-label": "value",
          [MIGRATION_LABEL_KEY]: "m0000",
          [MIGRATION_HISTORY_LABEL_KEY]: "hcurrent",
        },
      });
    });

    test("removes a stale history ID for a markerless local history", async () => {
      const setMetadataMock = vi.fn();
      const client = createMetadataClient(
        {
          labels: {
            "existing-label": "value",
            [MIGRATION_HISTORY_LABEL_KEY]: "hstale",
          },
        },
        setMetadataMock,
      );

      await updateMigrationLabel(client, workspaceId, namespace, 1);

      expect(setMetadataMock).toHaveBeenCalledWith({
        trn: expectedTrn,
        labels: {
          "existing-label": "value",
          [MIGRATION_LABEL_KEY]: "m0001",
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

    test("commits migration checkpoints immediately inside a resource metadata batch", async () => {
      const setMetadataMock = vi.fn();
      const bulkSetMetadata = vi.fn();
      const client = Object.assign(createMetadataClient({ labels: {} }, setMetadataMock), {
        bulkSetMetadata,
      });

      await withMetadataWriteBatch(client as never, async (batchClient) => {
        await updateMigrationLabel(batchClient, workspaceId, namespace, 2);
        expect(setMetadataMock).toHaveBeenCalledWith({
          trn: expectedTrn,
          labels: { [MIGRATION_LABEL_KEY]: "m0002" },
        });
      });

      expect(bulkSetMetadata).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // executeMigrations
  // ==========================================================================
  describe("executeMigrations", () => {
    const workspaceId = "test-workspace";

    function createMockContext(overrides: Partial<MigrationContext> = {}): MigrationContext {
      return {
        client: {} as unknown as OperatorClient,
        workspaceId,
        authNamespace: "auth",
        machineUsers: ["test-machine-user"],
        dbConfig: {},
        env: {},
        configDir: "/project",
        appName: "test-app",
        appId: "test-app-id",
        ...overrides,
      };
    }

    aroundEach(async (runTest) => {
      bundleMigrationScriptMock.mockReset();
      executeMigrationAsWorkflowMock.mockReset();
      bundleMigrationScriptMock.mockResolvedValue({
        bundledCode: "// bundled",
        warnings: [],
      });
      executeMigrationAsWorkflowMock.mockResolvedValue({
        success: true,
        logs: "",
      });
      await runTest();
    });

    const stepsForm: MigrationScriptForm = { kind: "steps", order: ["backfill"] };

    function stepsContext(setMetadataMock: ReturnType<typeof vi.fn>): MigrationContext {
      return {
        ...createMockContext(),
        client: createMetadataClient({ labels: {} }, setMetadataMock),
      };
    }

    test("treats another deploy's active run as in progress without touching its records", async () => {
      const setMetadataMock = vi.fn();
      const migration = createMockMigration({ scriptForm: stepsForm });
      executeMigrationStepsAsWorkflowMock.mockRejectedValueOnce(
        CLIError({
          code: "MIGRATION_EXECUTION_ACTIVE",
          message: "Migration tailordb/0001 has an execution that is still running (exec-2).",
        }),
      );

      await expect(
        executeMigrations(stepsContext(setMetadataMock), [migration]),
      ).rejects.toMatchObject({ code: "MIGRATION_PARTIALLY_APPLIED" });
      expect(setMetadataMock).not.toHaveBeenCalled();
    });

    interface MetadataFaults {
      /** `getMetadata` calls (0-based) that fail. */
      failGets?: number[];
      /** `setMetadata` calls that fail before writing. */
      failSets?: number[];
      /** `setMetadata` calls that write, then fail as if the response was lost. */
      loseSetResponses?: number[];
    }

    function createMetadataStore(faults: MetadataFaults) {
      let labels: Record<string, string> = {};
      let gets = 0;
      let sets = 0;
      const unavailable = () => new ConnectError("unavailable", Code.Unavailable);
      const client = {
        getMetadata: vi.fn(async () => {
          if (faults.failGets?.includes(gets++)) throw unavailable();
          return { metadata: { labels: { ...labels } } };
        }),
        setMetadata: vi.fn(async (request: { labels: Record<string, string> }) => {
          const call = sets++;
          if (faults.failSets?.includes(call)) throw unavailable();
          labels = { ...request.labels };
          if (faults.loseSetResponses?.includes(call)) throw unavailable();
          return {};
        }),
      } as unknown as OperatorClient;
      return { client, labels: () => labels };
    }

    const failBeforeStart = async (options: { onBeforeStart?: () => Promise<void> }) => {
      await options.onBeforeStart?.();
      throw new Error("could not create the workflow");
    };
    const failWithoutCommit = async (options: { onBeforeStart?: () => Promise<void> }) => {
      await options.onBeforeStart?.();
      return {
        success: false,
        logs: "",
        error: "boom",
        completedSteps: [],
        failedSteps: ["backfill"],
        stepsMayHaveCommitted: false,
      };
    };

    test.each([
      { name: "the record write is lost", run: failBeforeStart, faults: { loseSetResponses: [0] } },
      { name: "the record write fails", run: failBeforeStart, faults: { failSets: [0] } },
      { name: "the record read fails", run: failBeforeStart, faults: { failGets: [0] } },
      {
        name: "the record clear fails",
        run: failBeforeStart,
        faults: { loseSetResponses: [0], failSets: [1] },
      },
      {
        name: "the record clear is lost",
        run: failBeforeStart,
        faults: { loseSetResponses: [0, 1] },
      },
      {
        name: "the record clear and its read-back fail",
        run: failBeforeStart,
        faults: { loseSetResponses: [0], failSets: [1], failGets: [2] },
      },
      {
        name: "no step committed and the record clear is lost",
        run: failWithoutCommit,
        faults: { loseSetResponses: [1] },
      },
      {
        name: "no step committed and the record clear fails",
        run: failWithoutCommit,
        faults: { failSets: [1] },
      },
    ])("keeps the pre-migration schema exactly when the record stays: $name", async (scenario) => {
      const store = createMetadataStore(scenario.faults);
      const migration = createMockMigration({ scriptForm: stepsForm });
      executeMigrationStepsAsWorkflowMock.mockImplementationOnce(scenario.run);

      const error = await executeMigrations({ ...createMockContext(), client: store.client }, [
        migration,
      ]).then(
        () => undefined,
        (rejection: unknown) => rejection,
      );

      expect(error).toBeDefined();
      expect(Object.hasOwn(store.labels(), MIGRATION_IN_PROGRESS_LABEL_KEY)).toBe(
        isMigrationPartiallyApplied(error),
      );
    });

    test("keeps the record when it cannot confirm whether the run started", async () => {
      const store = createMetadataStore({});
      const migration = createMockMigration({ number: 3, scriptForm: stepsForm });
      const lost = new ConnectError("lost", Code.Unavailable);
      executeMigrationStepsAsWorkflowMock.mockImplementationOnce(
        async (options: { onBeforeStart?: () => Promise<void> }) => {
          await options.onBeforeStart?.();
          throw CLIError({
            code: "MIGRATION_START_UNCONFIRMED",
            message:
              "Could not confirm whether migration tailordb/0003 started: [unavailable] lost",
            suggestion: "Deploy again.",
            cause: lost,
          });
        },
      );

      await expect(
        executeMigrations({ ...createMockContext(), client: store.client }, [migration]),
      ).rejects.toMatchObject({
        code: "MIGRATION_PARTIALLY_APPLIED",
        message: "Could not confirm whether migration tailordb/0003 started: [unavailable] lost",
        suggestion:
          "Deploy again. Until the migration completes, the tables of namespace 'tailordb' stay in maintenance mode, as during the migration.",
      });
      expect(store.labels()).toHaveProperty(MIGRATION_IN_PROGRESS_LABEL_KEY);
    });

    test("asks to check the record when it can be neither cleared nor read", async () => {
      const store = createMetadataStore({ loseSetResponses: [0], failSets: [1], failGets: [2] });
      const migration = createMockMigration({ number: 3, scriptForm: stepsForm });
      executeMigrationStepsAsWorkflowMock.mockImplementationOnce(failBeforeStart);

      await expect(
        executeMigrations({ ...createMockContext(), client: store.client }, [migration]),
      ).rejects.toMatchObject({
        code: "MIGRATION_PARTIALLY_APPLIED",
        message:
          "Migration tailordb/0003 failed before any step completed: [unavailable] unavailable",
        suggestion: expect.stringContaining(
          "tailor tailordb migration sync 0002 --namespace tailordb",
        ),
      });
    });

    test("pauses the spinner for notices and reports a partial failure before its logs", async () => {
      const migration = createMockMigration({ scriptForm: stepsForm });
      executeMigrationStepsAsWorkflowMock.mockImplementationOnce(
        async (options: { notify?: (level: "info" | "warn", message: string) => void }) => {
          options.notify?.("warn", "cannot be resumed; every step runs again");
          return {
            success: false,
            logs: "[backfill] boom",
            error: "boom",
            executionId: "exec-1",
            completedSteps: ["backfill"],
            failedSteps: [],
            stepsMayHaveCommitted: true,
          };
        },
      );
      vi.mocked(logger.warn).mockClear();
      vi.mocked(logger.error).mockClear();
      spinnerMock.stop.mockClear();
      spinnerMock.start.mockClear();
      spinnerMock.fail.mockClear();

      await expect(
        executeMigrations(stepsContext(vi.fn()), [migration], { tailordb: { number: 1 } }),
      ).rejects.toMatchObject({ code: "MIGRATION_PARTIALLY_APPLIED" });

      const order = (mock: { mock: { invocationCallOrder: number[] } }) =>
        mock.mock.invocationCallOrder[0] ?? Number.NaN;
      expect(order(spinnerMock.stop)).toBeLessThan(order(vi.mocked(logger.warn)));
      expect(order(vi.mocked(logger.warn))).toBeLessThan(order(spinnerMock.start));
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith("Logs:\n[backfill] boom");
      expect(order(spinnerMock.fail)).toBeLessThan(order(vi.mocked(logger.error)));
    });

    test("keeps the remediation of a failure that is not a step's own", async () => {
      const migration = createMockMigration({
        scriptForm: { kind: "steps", order: ["backfill"] },
      });
      executeMigrationStepsAsWorkflowMock.mockRejectedValueOnce(
        CLIError({
          code: "MIGRATION_EXECUTION_ACTIVE",
          message: "Migration tailordb/0001 has an execution that is still running (exec-2).",
          suggestion: "Wait for it to finish, then deploy again.",
        }),
      );

      await expect(
        executeMigrations(createMockContext(), [migration], { tailordb: { number: 1 } }),
      ).rejects.toMatchObject({
        code: "MIGRATION_PARTIALLY_APPLIED",
        suggestion: expect.stringContaining("Wait for it to finish, then deploy again."),
      });
    });

    test("runs a migration as a workflow rather than a synchronous script execution", async () => {
      const migrations = [createMockMigration({ number: 1, hasScript: true })];

      await executeMigrations(createMockContext(), migrations);

      expect(executeMigrationAsWorkflowMock).toHaveBeenCalledTimes(1);
      expect(executeMigrationAsWorkflowMock.mock.calls[0]![0]).toMatchObject({
        namespace: "tailordb",
        migrationNumber: 1,
        code: "// bundled",
        appName: "test-app",
        appId: "test-app-id",
      });
    });

    test("surfaces a failed workflow migration as a migration failure", async () => {
      executeMigrationAsWorkflowMock.mockResolvedValue({
        success: false,
        logs: "boom",
        error: "workflow failed",
      });
      const migrations = [createMockMigration({ number: 1, hasScript: true })];

      await expect(executeMigrations(createMockContext(), migrations)).rejects.toThrow(
        "workflow failed",
      );
    });

    test("skips migrations without a script file on disk", async () => {
      const migrations = [
        createMockMigration({ number: 1, hasScript: false }),
        createMockMigration({ number: 2, hasScript: false }),
      ];

      await executeMigrations(createMockContext(), migrations);

      expect(bundleMigrationScriptMock).not.toHaveBeenCalled();
      expect(executeMigrationAsWorkflowMock).not.toHaveBeenCalled();
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
          diff: createMockMigrationDiff({ hasWarnings: true, requiresMigrationScript: false }),
        }),
        createMockMigration({
          number: 2,
          hasScript: false,
          diff: createMockMigrationDiff({ hasWarnings: true, requiresMigrationScript: false }),
        }),
      ];

      await executeMigrations(createMockContext(), migrations);

      expect(bundleMigrationScriptMock).toHaveBeenCalledTimes(1);
      expect(executeMigrationAsWorkflowMock).toHaveBeenCalledTimes(1);
      expect(executeMigrationAsWorkflowMock.mock.calls[0]![0]).toMatchObject({
        migrationNumber: 1,
      });
    });

    test("runs each migration script with the temporal mode recorded in its diff", async () => {
      const migrations = [
        createMockMigration({
          number: 1,
          hasScript: true,
          diff: createMockMigrationDiff({ temporal: true }),
        }),
        createMockMigration({ number: 2, hasScript: true }),
      ];

      await executeMigrations(createMockContext(), migrations);

      expect(bundleMigrationScriptMock.mock.calls.map((call) => call[5])).toEqual([true, false]);
    });

    test("runs each migration script with the date default recorded in its diff", async () => {
      const migrations = [
        createMockMigration({
          number: 1,
          hasScript: true,
          diff: createMockMigrationDiff({ dateRepresentation: "temporal" }),
        }),
        createMockMigration({ number: 2, hasScript: true }),
      ];

      await executeMigrations(createMockContext(), migrations);

      expect(bundleMigrationScriptMock.mock.calls.map((call) => call[6])).toEqual([
        "temporal",
        "legacy",
      ]);
    });

    test("runs each steps script with the temporal mode recorded in its diff", async () => {
      const migrations = [
        createMockMigration({
          number: 1,
          scriptForm: stepsForm,
          diff: createMockMigrationDiff({ temporal: true }),
        }),
        createMockMigration({ number: 2, scriptForm: stepsForm }),
      ];
      const completed = {
        success: true,
        logs: "",
        completedSteps: ["backfill"],
        failedSteps: [],
        stepsMayHaveCommitted: true,
      };
      bundleMigrationStepsMock.mockClear();
      executeMigrationStepsAsWorkflowMock
        .mockResolvedValueOnce(completed)
        .mockResolvedValueOnce(completed);

      await executeMigrations(stepsContext(vi.fn()), migrations);

      expect(bundleMigrationStepsMock.mock.calls.map(([options]) => options.temporal)).toEqual([
        true,
        false,
      ]);
    });

    test("runs each steps script with the date default recorded in its diff", async () => {
      const migrations = [
        createMockMigration({
          number: 1,
          scriptForm: stepsForm,
          diff: createMockMigrationDiff({ dateRepresentation: "temporal" }),
        }),
        createMockMigration({ number: 2, scriptForm: stepsForm }),
      ];
      const completed = {
        success: true,
        logs: "",
        completedSteps: ["backfill"],
        failedSteps: [],
        stepsMayHaveCommitted: true,
      };
      bundleMigrationStepsMock.mockClear();
      executeMigrationStepsAsWorkflowMock
        .mockResolvedValueOnce(completed)
        .mockResolvedValueOnce(completed);

      await executeMigrations(stepsContext(vi.fn()), migrations);

      expect(bundleMigrationStepsMock.mock.calls.map(([options]) => options.dateDefault)).toEqual([
        "temporal",
        "legacy",
      ]);
    });

    test("executes only the subset with hasScript=true when mixed with breaking changes", async () => {
      const migrations = [
        createMockMigration({
          number: 1,
          hasScript: true,
          diff: createMockMigrationDiff({
            hasBreakingChanges: true,
            requiresMigrationScript: true,
          }),
        }),
        createMockMigration({
          number: 2,
          hasScript: false,
          diff: createMockMigrationDiff({ hasWarnings: true, requiresMigrationScript: false }),
        }),
        createMockMigration({
          number: 3,
          hasScript: true,
          diff: createMockMigrationDiff({ hasWarnings: true, requiresMigrationScript: false }),
        }),
      ];

      await executeMigrations(createMockContext(), migrations);

      expect(executeMigrationAsWorkflowMock).toHaveBeenCalledTimes(2);
      const executedNumbers = executeMigrationAsWorkflowMock.mock.calls.map(
        (call) => (call[0] as { migrationNumber: number }).migrationNumber,
      );
      expect(executedNumbers).toEqual([1, 3]);
    });

    describe("timing", () => {
      let clock = 0;
      aroundEach(async (runTest) => {
        clock = 0;
        const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
        vi.mocked(logger.info).mockClear();
        vi.mocked(logger.debug).mockClear();
        spinnerMock.succeed.mockClear();
        try {
          await runTest();
        } finally {
          now.mockRestore();
        }
      });

      function emitting(events: (MigrationRunEvent | { advanceTo: number })[]) {
        const texts: string[] = [];
        executeMigrationAsWorkflowMock.mockImplementationOnce(
          async (options: { onRunEvent?: (event: MigrationRunEvent) => void }) => {
            for (const event of events) {
              if ("advanceTo" in event) {
                clock = event.advanceTo;
                continue;
              }
              clock = event.at;
              options.onRunEvent?.(event);
              texts.push(spinnerMock.text);
            }
            return { success: true, logs: "" };
          },
        );
        return texts;
      }

      const polled = (at: number, job: WorkflowJobExecution_Status): MigrationRunEvent => ({
        type: "polled",
        at,
        execution: {
          status: WorkflowExecution_Status.RUNNING,
          jobExecutions: [{ status: job, kind: { case: "jobFunction", value: { name: "job" } } }],
        } as never,
      });

      test("reports how long the script waited for its job to start and how long it ran", async () => {
        emitting([
          { advanceTo: 2_000 },
          { type: "waiting", at: 2_000 },
          { type: "running", at: 62_000 },
          { type: "finished", at: 71_000, scriptStarted: true },
          { advanceTo: 72_000 },
        ]);
        const timeline = new MaintenanceTimeline();
        timeline.enter("preMigration", 0);

        await executeMigrations(createMockContext(), [createMockMigration()], {}, timeline);
        timeline.finish(72_000);

        expect(logger.info).toHaveBeenCalledWith(
          "Migration tailordb/0001 started running after waiting 1m00s for its job to start.",
          { mode: "stream" },
        );
        expect(spinnerMock.succeed).toHaveBeenCalledWith(
          "Migration tailordb/0001 completed successfully (waiting to start 1m00s, running 9.0s)",
        );
        expect(timeline.report(["tailordb"])).toMatchObject({
          phases: { jobSetup: 2_000, waitingToStart: 60_000, running: 9_000, jobCleanup: 1_000 },
          migrations: [
            {
              namespace: "tailordb",
              migrationNumber: 1,
              startObserved: true,
              waitingToStartMs: 60_000,
              runningMs: 9_000,
            },
          ],
        });
      });

      test("does not split a run whose script was never seen starting", async () => {
        emitting([
          { type: "waiting", at: 1_000 },
          { type: "finished", at: 5_000, scriptStarted: false },
        ]);
        const timeline = new MaintenanceTimeline();
        timeline.enter("preMigration", 0);

        await executeMigrations(createMockContext(), [createMockMigration()], {}, timeline);

        expect(logger.info).not.toHaveBeenCalledWith(
          expect.stringContaining("started running"),
          expect.anything(),
        );
        expect(spinnerMock.succeed).toHaveBeenCalledWith(
          "Migration tailordb/0001 completed successfully",
        );
        expect(timeline.report(["tailordb"]).migrations).toEqual([
          expect.objectContaining({
            startObserved: false,
            waitingToStartMs: null,
            runningMs: null,
          }),
        ]);
      });

      test("updates the spinner before reporting that the script started running", async () => {
        emitting([
          { type: "waiting", at: 1_000 },
          { type: "running", at: 16_000 },
        ]);
        let textOnRestart: string | undefined;
        spinnerMock.start.mockImplementationOnce(() => {
          textOnRestart = spinnerMock.text;
        });

        await executeMigrations(createMockContext(), [createMockMigration()]);

        expect(textOnRestart).toBe("Running migration tailordb/0001 (0.0s)...");
      });

      test("stops the spinner before logging the run's phases", async () => {
        emitting([
          { type: "waiting", at: 1_000 },
          { type: "running", at: 16_000 },
          { type: "finished", at: 20_000, scriptStarted: true },
        ]);
        spinnerMock.start.mockClear();
        spinnerMock.stop.mockClear();
        const timeline = new MaintenanceTimeline();
        timeline.enter("preMigration", 0);

        await executeMigrations(createMockContext(), [createMockMigration()], {}, timeline);

        const debug = vi.mocked(logger.debug).mock;
        const firstPhaseLine = debug.calls.findIndex(([message]) =>
          message.startsWith("Maintenance phase"),
        );
        expect(firstPhaseLine).toBeGreaterThanOrEqual(0);
        const phaseLoggedAt = debug.invocationCallOrder[firstPhaseLine] ?? Number.NaN;
        const lastRestartAt = Math.max(...spinnerMock.start.mock.invocationCallOrder);
        expect(
          spinnerMock.stop.mock.invocationCallOrder.some(
            (order) => order > lastRestartAt && order < phaseLoggedAt,
          ),
        ).toBe(true);
      });

      test("shows in the spinner what the run is doing and for how long", async () => {
        const texts = emitting([
          { type: "waiting", at: 1_000 },
          polled(13_000, WorkflowJobExecution_Status.RUNNING),
          { type: "running", at: 16_000 },
          polled(16_000, WorkflowJobExecution_Status.RUNNING),
          polled(21_000, WorkflowJobExecution_Status.RUNNING),
        ]);

        await executeMigrations(createMockContext(), [createMockMigration()]);

        expect(texts).toEqual([
          "Waiting for a job of migration tailordb/0001 to start (0.0s)...",
          "Waiting for a job of migration tailordb/0001 to start (12s)...",
          "Running migration tailordb/0001 (0.0s)...",
          "Running migration tailordb/0001 (0.0s)...",
          "Running migration tailordb/0001 (5.0s)...",
        ]);
      });

      test("logs each change of the run's status under --verbose", async () => {
        emitting([
          { type: "waiting", at: 1_000 },
          polled(2_000, WorkflowJobExecution_Status.RUNNING),
          polled(5_000, WorkflowJobExecution_Status.RUNNING),
          polled(8_000, WorkflowJobExecution_Status.SUCCESS),
        ]);
        logger.verbose = true;

        try {
          await executeMigrations(createMockContext(), [createMockMigration()]);
        } finally {
          logger.verbose = false;
        }

        const statusLines = vi
          .mocked(logger.debug)
          .mock.calls.map(([message]) => message)
          .filter((message) => message.includes("workflow execution"));
        expect(statusLines).toEqual([
          "Migration tailordb/0001: workflow execution RUNNING, jobs job=RUNNING.",
          "Migration tailordb/0001: workflow execution RUNNING, jobs job=SUCCESS.",
        ]);
      });

      test("explains under --verbose only for a run whose script was never seen starting", async () => {
        emitting([
          { type: "waiting", at: 1_000 },
          { type: "running", at: 2_000 },
          { type: "finished", at: 3_000, scriptStarted: true },
        ]);
        emitting([
          { type: "waiting", at: 4_000 },
          { type: "finished", at: 5_000, scriptStarted: false },
        ]);
        logger.verbose = true;

        try {
          await executeMigrations(createMockContext(), [
            createMockMigration({ number: 1 }),
            createMockMigration({ number: 2 }),
          ]);
        } finally {
          logger.verbose = false;
        }

        const unsplit = vi
          .mocked(logger.debug)
          .mock.calls.map(([message]) => message)
          .filter((message) => message.startsWith("Could not observe"));
        expect(unsplit).toEqual([
          "Could not observe when migration tailordb/0002 started running, so its run is not split into waiting and running.",
        ]);
      });

      test("shows a steps migration's progress next to how long it has run", async () => {
        let text: string | undefined;
        executeMigrationStepsAsWorkflowMock.mockImplementationOnce(
          async (options: {
            onRunEvent: (event: MigrationRunEvent) => void;
            onProgress: (completed: number, total: number) => void;
          }) => {
            clock = 1_000;
            options.onRunEvent({ type: "waiting", at: clock });
            clock = 16_000;
            options.onRunEvent({ type: "running", at: clock });
            clock = 21_000;
            options.onProgress(0, 1);
            text = spinnerMock.text;
            return {
              success: true,
              logs: "",
              completedSteps: ["backfill"],
              failedSteps: [],
              stepsMayHaveCommitted: true,
            };
          },
        );

        await executeMigrations(createMockContext(), [
          createMockMigration({ scriptForm: stepsForm }),
        ]);

        expect(text).toBe("Running migration tailordb/0001 (0/1 steps completed, 5.0s)...");
      });
    });
  });
});
