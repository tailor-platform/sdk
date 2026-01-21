import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, it, vi, beforeEach, afterAll, afterEach } from "vitest";
import {
  SCHEMA_SNAPSHOT_VERSION,
  MIGRATION_LABEL_KEY,
  formatMigrationNumber,
  DIFF_FILE_NAME,
  MIGRATE_FILE_NAME,
} from "../../../tailordb/migrate/types";
import {
  detectPendingMigrations,
  updateMigrationLabel,
  getMigrationMachineUser,
} from "./migration";
import type { OperatorClient } from "../../../client";
import type { MigrationDiff, NamespaceWithMigrations } from "../../../tailordb/migrate/types";

// Mock label.ts for trnPrefix
vi.mock("../label", () => ({
  trnPrefix: (workspaceId: string) => `trn:v1:workspace:${workspaceId}`,
}));

// Mock logger to suppress output during tests
vi.mock("../../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    newline: vi.fn(),
  },
  styles: {
    bold: (s: string) => s,
  },
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
    requiresMigrationScript: false,
    ...options,
  };
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

describe("migration", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(
      TEST_MIGRATIONS_BASE,
      `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
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
    it("returns explicit machineUser from config", () => {
      const result = getMigrationMachineUser({ machineUser: "explicit-user" }, ["fallback-user"]);
      expect(result).toBe("explicit-user");
    });

    it("falls back to first machine user from auth", () => {
      const result = getMigrationMachineUser(undefined, ["first-user", "second-user"]);
      expect(result).toBe("first-user");
    });

    it("falls back to first machine user when config has no machineUser", () => {
      const result = getMigrationMachineUser({}, ["first-user", "second-user"]);
      expect(result).toBe("first-user");
    });

    it("returns undefined when no machine users available", () => {
      const result = getMigrationMachineUser(undefined, undefined);
      expect(result).toBeUndefined();
    });

    it("returns undefined when machine users array is empty", () => {
      const result = getMigrationMachineUser(undefined, []);
      expect(result).toBeUndefined();
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

    it("returns empty array when no pending migrations", async () => {
      const client = createMockClient({ tailordb: 1 });

      // Create migration 0001 (already applied)
      writeDiffFile(testDir, 1, createMockDiff());

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);
      expect(result).toHaveLength(0);
    });

    it("detects single pending migration", async () => {
      const client = createMockClient({ tailordb: 0 });

      // Create migration 0001 (pending)
      writeDiffFile(testDir, 1, createMockDiff());

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);

      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(1);
      expect(result[0].namespace).toBe("tailordb");
    });

    it("detects multiple pending migrations", async () => {
      const client = createMockClient({ tailordb: 1 });

      // Create migrations 0002 and 0003 (pending)
      writeDiffFile(testDir, 2, createMockDiff());
      writeDiffFile(testDir, 3, createMockDiff());

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);

      expect(result).toHaveLength(2);
      expect(result[0].number).toBe(2);
      expect(result[1].number).toBe(3);
    });

    it("skips migrations without diff file", async () => {
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

    it("warns when breaking change migration missing script", async () => {
      const { logger } = await import("../../../utils/logger");
      const client = createMockClient({ tailordb: 0 });

      // Create migration with breaking change but no script
      writeDiffFile(
        testDir,
        1,
        createMockDiff({
          hasBreakingChanges: true,
          requiresMigrationScript: true,
        }),
      );
      // No migrate.ts file

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);

      expect(result).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("requires a script but migrate.ts not found"),
      );
    });

    it("includes breaking change migration with script", async () => {
      const client = createMockClient({ tailordb: 0 });

      // Create migration with breaking change and script
      writeDiffFile(
        testDir,
        1,
        createMockDiff({
          hasBreakingChanges: true,
          requiresMigrationScript: true,
        }),
      );
      writeMigrateFile(testDir, 1, "export async function main() {}");

      const namespacesWithMigrations: NamespaceWithMigrations[] = [
        { namespace: "tailordb", migrationsDir: testDir },
      ];

      const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);

      expect(result).toHaveLength(1);
      expect(result[0].diff.requiresMigrationScript).toBe(true);
    });

    it("sorts migrations by namespace and number", async () => {
      const testDir2 = path.join(
        TEST_MIGRATIONS_BASE,
        `test2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      fs.mkdirSync(testDir2, { recursive: true });

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

      expect(result).toHaveLength(4);
      // Should be sorted by namespace first, then by number
      expect(result[0].namespace).toBe("namespace-a");
      expect(result[0].number).toBe(1);
      expect(result[1].namespace).toBe("namespace-a");
      expect(result[1].number).toBe(2);
      expect(result[2].namespace).toBe("namespace-b");
      expect(result[2].number).toBe(1);
      expect(result[3].namespace).toBe("namespace-b");
      expect(result[3].number).toBe(2);
    });

    describe("TAILOR_APPLY_MIGRATION_VERSION environment variable", () => {
      const originalEnv = process.env.TAILOR_APPLY_MIGRATION_VERSION;

      afterEach(() => {
        if (originalEnv === undefined) {
          delete process.env.TAILOR_APPLY_MIGRATION_VERSION;
        } else {
          process.env.TAILOR_APPLY_MIGRATION_VERSION = originalEnv;
        }
      });

      it("respects TAILOR_APPLY_MIGRATION_VERSION environment variable", async () => {
        process.env.TAILOR_APPLY_MIGRATION_VERSION = "2";
        const client = createMockClient({ tailordb: 0 });

        // Create migrations 0001, 0002, 0003
        writeDiffFile(testDir, 1, createMockDiff());
        writeDiffFile(testDir, 2, createMockDiff());
        writeDiffFile(testDir, 3, createMockDiff());

        const namespacesWithMigrations: NamespaceWithMigrations[] = [
          { namespace: "tailordb", migrationsDir: testDir },
        ];

        const result = await detectPendingMigrations(client, workspaceId, namespacesWithMigrations);

        // Should only include migrations up to version 2
        expect(result).toHaveLength(2);
        expect(result[0].number).toBe(1);
        expect(result[1].number).toBe(2);
      });

      it("throws error for invalid TAILOR_APPLY_MIGRATION_VERSION", async () => {
        process.env.TAILOR_APPLY_MIGRATION_VERSION = "invalid";
        const client = createMockClient({ tailordb: 0 });

        const namespacesWithMigrations: NamespaceWithMigrations[] = [
          { namespace: "tailordb", migrationsDir: testDir },
        ];

        await expect(
          detectPendingMigrations(client, workspaceId, namespacesWithMigrations),
        ).rejects.toThrow("Invalid TAILOR_APPLY_MIGRATION_VERSION");
      });
    });
  });

  // ==========================================================================
  // updateMigrationLabel
  // ==========================================================================
  describe("updateMigrationLabel", () => {
    const workspaceId = "test-workspace";
    const namespace = "tailordb";

    it("updates migration label on service metadata", async () => {
      const setMetadataMock = vi.fn();
      const client = {
        getMetadata: vi.fn().mockResolvedValue({
          metadata: {
            labels: {},
          },
        }),
        setMetadata: setMetadataMock,
      } as unknown as OperatorClient;

      await updateMigrationLabel(client, workspaceId, namespace, 5);

      expect(setMetadataMock).toHaveBeenCalledWith({
        trn: `trn:v1:workspace:${workspaceId}:tailordb:${namespace}`,
        labels: {
          [MIGRATION_LABEL_KEY]: "m0005",
        },
      });
    });

    it("preserves existing labels", async () => {
      const setMetadataMock = vi.fn();
      const client = {
        getMetadata: vi.fn().mockResolvedValue({
          metadata: {
            labels: {
              "existing-label": "value",
              "another-label": "another-value",
            },
          },
        }),
        setMetadata: setMetadataMock,
      } as unknown as OperatorClient;

      await updateMigrationLabel(client, workspaceId, namespace, 3);

      expect(setMetadataMock).toHaveBeenCalledWith({
        trn: `trn:v1:workspace:${workspaceId}:tailordb:${namespace}`,
        labels: {
          "existing-label": "value",
          "another-label": "another-value",
          [MIGRATION_LABEL_KEY]: "m0003",
        },
      });
    });

    it("handles missing metadata gracefully", async () => {
      const setMetadataMock = vi.fn();
      const client = {
        getMetadata: vi.fn().mockResolvedValue({
          metadata: null,
        }),
        setMetadata: setMetadataMock,
      } as unknown as OperatorClient;

      await updateMigrationLabel(client, workspaceId, namespace, 1);

      expect(setMetadataMock).toHaveBeenCalledWith({
        trn: `trn:v1:workspace:${workspaceId}:tailordb:${namespace}`,
        labels: {
          [MIGRATION_LABEL_KEY]: "m0001",
        },
      });
    });
  });
});
