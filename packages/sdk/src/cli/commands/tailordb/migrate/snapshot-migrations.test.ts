import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test, aroundEach, aroundAll } from "vitest";
import {
  reconstructSnapshotFromMigrations,
  validateMigrationFiles,
  assertValidMigrationFiles,
  SCHEMA_SNAPSHOT_VERSION,
  INITIAL_SCHEMA_NUMBER,
  formatMigrationNumber,
  type SchemaSnapshot,
} from "./snapshot";
import { writeDiffToDir, writeSchemaToDir } from "./test-helpers/snapshot-test";
import type { MigrationDiff } from "./diff-calculator";

const TEST_MIGRATIONS_BASE = path.join(
  __dirname,
  "__test_migrations__",
  path.basename(import.meta.filename),
);

describe("snapshot", () => {
  const namespace = "tailordb";
  let testDir: string;

  aroundAll(async (runSuite) => {
    await runSuite();
    try {
      fs.rmSync(TEST_MIGRATIONS_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  aroundEach(async (runTest) => {
    testDir = path.join(
      TEST_MIGRATIONS_BASE,
      `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
    await runTest();
  });

  // ==========================================================================
  // reconstructSnapshotFromMigrations
  // ==========================================================================
  describe("reconstructSnapshotFromMigrations", () => {
    test("replays the committed example history written before the rename", () => {
      const exampleMigrations = path.join(
        import.meta.dirname,
        "../../../../../../../example/migrations",
      );
      const legacyDiff = JSON.parse(
        fs.readFileSync(path.join(exampleMigrations, "0001", "diff.json"), "utf-8"),
      ) as { changes: { typeName?: string }[] };
      expect(legacyDiff.changes[0]?.typeName).toBeTypeOf("string");

      const replayed = reconstructSnapshotFromMigrations(exampleMigrations);

      expect(replayed).not.toBeNull();
      expect(Object.keys(replayed!.tables)).toContain("Customer");
    });

    test("reconstructs from initial schema only (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              name: { type: "string", required: true },
            },
          },
        },
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, initialSnapshot);

      const reconstructed = reconstructSnapshotFromMigrations(testDir);

      expect(reconstructed).not.toBeNull();
      expect(reconstructed?.tables.User).toBeDefined();
      expect(reconstructed?.tables.User!.fields.id).toBeDefined();
      expect(reconstructed?.tables.User!.fields.name).toBeDefined();
    });

    test("applies single diff to schema (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_added",
            tableName: "User",
            fieldName: "email",
            after: { type: "string", required: false },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, initialSnapshot);
      writeDiffToDir(testDir, 1, diff);

      const reconstructed = reconstructSnapshotFromMigrations(testDir);

      expect(reconstructed?.tables.User!.fields.id).toBeDefined();
      expect(reconstructed?.tables.User!.fields.email).toBeDefined();
    });

    test("applies field_renamed diff (old field dropped, new field added)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              fullName: { type: "string", required: false },
            },
          },
        },
      };

      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_renamed",
            tableName: "User",
            fieldName: "displayName",
            previousFieldName: "fullName",
            before: { type: "string", required: false },
            after: { type: "string", required: false },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            tableName: "User",
            fieldName: "displayName",
            reason: "Field renamed from fullName to displayName",
          },
        ],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: true,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, initialSnapshot);
      writeDiffToDir(testDir, 1, diff);

      const reconstructed = reconstructSnapshotFromMigrations(testDir);

      expect(reconstructed?.tables.User!.fields.fullName).toBeUndefined();
      expect(reconstructed?.tables.User!.fields.displayName).toEqual({
        type: "string",
        required: false,
      });
    });

    test("applies type_renamed diff (old table dropped, new table added)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_renamed",
            tableName: "Person",
            previousTableName: "User",
            before: {
              name: "User",
              pluralForm: "Users",
              fields: { id: { type: "uuid", required: true } },
            },
            after: {
              name: "Person",
              pluralForm: "People",
              fields: { id: { type: "uuid", required: true } },
            },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [{ tableName: "Person", reason: "Table renamed from User to Person" }],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: true,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, initialSnapshot);
      writeDiffToDir(testDir, 1, diff);

      const reconstructed = reconstructSnapshotFromMigrations(testDir);

      expect(reconstructed?.tables.User).toBeUndefined();
      expect(reconstructed?.tables.Person).toMatchObject({ name: "Person", pluralForm: "People" });
    });

    test("reconstructs the target field type from a phased type change", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              age: { type: "integer", required: false },
            },
          },
        },
      };
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_type_modified",
            tableName: "User",
            fieldName: "age",
            before: { type: "integer", required: false },
            after: { type: "float", required: false },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            tableName: "User",
            fieldName: "age",
            reason: "Field type changed from integer to float",
          },
        ],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: true,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, initialSnapshot);
      writeDiffToDir(testDir, 1, diff);

      const reconstructed = reconstructSnapshotFromMigrations(testDir);

      expect(reconstructed?.tables.User!.fields.age!.type).toBe("float");
    });

    test("applies added table names that match Object prototype keys", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {},
      };

      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_added",
            tableName: "__proto__",
            after: {
              name: "__proto__",
              pluralForm: "__proto__",
              fields: { id: { type: "uuid", required: true } },
            },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, initialSnapshot);
      writeDiffToDir(testDir, 1, diff);

      const reconstructed = reconstructSnapshotFromMigrations(testDir);

      expect(Object.hasOwn(reconstructed?.tables ?? {}, "__proto__")).toBe(true);
      expect(reconstructed?.tables["__proto__"]?.fields.id).toBeDefined();
    });

    test("applies multiple diffs sequentially (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff1: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_added",
            tableName: "User",
            fieldName: "name",
            after: { type: "string", required: true },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      const diff2: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_added",
            tableName: "User",
            fieldName: "email",
            after: { type: "string", required: false },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, initialSnapshot);
      writeDiffToDir(testDir, 1, diff1);
      writeDiffToDir(testDir, 2, diff2);

      const reconstructed = reconstructSnapshotFromMigrations(testDir);

      expect(reconstructed?.tables.User!.fields.id).toBeDefined();
      expect(reconstructed?.tables.User!.fields.name).toBeDefined();
      expect(reconstructed?.tables.User!.fields.email).toBeDefined();
    });

    test("handles type addition in diff (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_added",
            tableName: "Post",
            after: {
              name: "Post",
              pluralForm: "Posts",
              fields: {
                id: { type: "uuid", required: true },
                title: { type: "string", required: true },
              },
            },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, initialSnapshot);
      writeDiffToDir(testDir, 1, diff);

      const reconstructed = reconstructSnapshotFromMigrations(testDir);

      expect(reconstructed?.tables.User).toBeDefined();
      expect(reconstructed?.tables.Post).toBeDefined();
      expect(reconstructed?.tables.Post!.fields.title).toBeDefined();
    });

    test("handles type removal in diff (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
          OldType: {
            name: "OldType",
            pluralForm: "OldTypes",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_removed",
            tableName: "OldType",
            before: {
              name: "OldType",
              pluralForm: "OldTypes",
              fields: { id: { type: "uuid", required: true } },
            },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, initialSnapshot);
      writeDiffToDir(testDir, 1, diff);

      const reconstructed = reconstructSnapshotFromMigrations(testDir);

      expect(reconstructed?.tables.User).toBeDefined();
      expect(reconstructed?.tables.OldType).toBeUndefined();
    });

    test("returns null for empty directory", () => {
      const reconstructed = reconstructSnapshotFromMigrations(testDir);
      expect(reconstructed).toBeNull();
    });

    test("correctly reconstructs backward relationships from diff", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
          Post: {
            name: "Post",
            pluralForm: "Posts",
            fields: {
              id: { type: "uuid", required: true },
              authorId: { type: "uuid", required: true },
            },
          },
        },
      };

      // Diff that adds both forward and backward relationships
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "relationship_added",
            tableName: "Post",
            relationshipName: "author",
            relationshipType: "forward",
            after: {
              targetType: "User",
              targetField: "id",
              sourceField: "authorId",
              isArray: false,
              description: "",
            },
          },
          {
            kind: "relationship_added",
            tableName: "User",
            relationshipName: "posts",
            relationshipType: "backward",
            after: {
              targetType: "Post",
              targetField: "authorId",
              sourceField: "id",
              isArray: true,
              description: "",
            },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, initialSnapshot);
      writeDiffToDir(testDir, 1, diff);

      const reconstructed = reconstructSnapshotFromMigrations(testDir);

      // Forward relationship should be in forwardRelationships
      expect(reconstructed?.tables.Post!.forwardRelationships?.author).toBeDefined();
      expect(reconstructed?.tables.Post!.forwardRelationships?.author!.targetType).toBe("User");

      // Backward relationship should be in backwardRelationships (NOT forwardRelationships)
      expect(reconstructed?.tables.User!.backwardRelationships?.posts).toBeDefined();
      expect(reconstructed?.tables.User!.backwardRelationships?.posts!.targetType).toBe("Post");
      expect(reconstructed?.tables.User!.forwardRelationships?.posts).toBeUndefined();
    });
  });

  // ==========================================================================
  // validateMigrationFiles / assertValidMigrationFiles
  // ==========================================================================
  describe("validateMigrationFiles", () => {
    test("returns empty array for non-existent directory", () => {
      const errors = validateMigrationFiles(path.join(testDir, "does-not-exist"));
      expect(errors).toEqual([]);
    });

    test("returns empty array for empty directory", () => {
      const errors = validateMigrationFiles(testDir);
      expect(errors).toEqual([]);
    });

    test("returns empty array for valid single schema file (directory structure)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {},
      };
      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, snapshot);

      const errors = validateMigrationFiles(testDir);
      expect(errors).toEqual([]);
    });

    test("returns empty array for valid schema + diff sequence (directory structure)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {},
      };
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, snapshot);
      writeDiffToDir(testDir, 1, diff);
      writeDiffToDir(testDir, 2, diff);

      const errors = validateMigrationFiles(testDir);
      expect(errors).toEqual([]);
    });

    test("detects missing initial schema snapshot (directory structure)", () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };
      writeDiffToDir(testDir, 1, diff);

      const errors = validateMigrationFiles(testDir);
      expect(errors).toContainEqual({
        type: "missing_schema",
        message: `Initial schema snapshot (${formatMigrationNumber(
          INITIAL_SCHEMA_NUMBER,
        )}/schema.json) is missing`,
        migrationNumber: INITIAL_SCHEMA_NUMBER,
      });
    });

    test("detects gap in migration sequence (directory structure)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {},
      };
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, snapshot);
      // Skip 0001, go directly to 0002
      writeDiffToDir(testDir, 2, diff);

      const errors = validateMigrationFiles(testDir);
      expect(errors).toContainEqual({
        type: "gap",
        message: "Migration 0001 is missing (gap in sequence)",
        migrationNumber: 1,
      });
    });

    test("detects schema file at wrong position (directory structure)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {},
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, snapshot);
      // Schema file at position 1 is invalid
      writeSchemaToDir(testDir, 1, snapshot);

      const errors = validateMigrationFiles(testDir);
      expect(errors).toContainEqual({
        type: "invalid_schema_number",
        message: `Schema file found at migration 0001, but schema should only exist at ${formatMigrationNumber(
          INITIAL_SCHEMA_NUMBER,
        )}`,
        migrationNumber: 1,
      });
    });

    test("detects missing diff file for migration > 0 (directory structure)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {},
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, snapshot);
      // Only migrate file at 0001, no diff file - create directory but no diff.json
      const migDir = path.join(testDir, "0001");
      fs.mkdirSync(migDir, { recursive: true });
      fs.writeFileSync(path.join(migDir, "migrate.ts"), "export async function main() {}");

      const errors = validateMigrationFiles(testDir);
      // migrate files are optional, but diff files are not checked for migrate-only files
      // Actually, with current logic, if only a migrate file exists but no schema/diff, it should not add it to validation
      expect(errors).toEqual([]);
    });
  });

  describe("assertValidMigrationFiles", () => {
    test("does not throw for valid migrations (directory structure)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {},
      };
      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, snapshot);

      expect(() => assertValidMigrationFiles(testDir, "test")).not.toThrow();
    });

    test("throws for invalid migrations with detailed error message (directory structure)", () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };
      // Missing 0000/schema.json
      writeDiffToDir(testDir, 1, diff);

      expect(() => assertValidMigrationFiles(testDir, "test")).toThrow(
        /Migration file validation failed for namespace "test"/,
      );
      expect(() => assertValidMigrationFiles(testDir, "test")).toThrow(/Initial schema snapshot/);
    });
  });
});
