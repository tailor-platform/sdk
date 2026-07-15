import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { SCHEMA_SNAPSHOT_VERSION } from "./diff-calculator";
import {
  SCHEMA_FILE_NAME,
  DIFF_FILE_NAME,
  MIGRATE_FILE_NAME,
  DB_TYPES_FILE_NAME,
  getMigrationDirPath,
  type SchemaSnapshot,
} from "./snapshot";
import {
  generateSchemaFile,
  generateDiffFiles,
  migrationScriptExists,
  getMigrationScriptPath,
} from "./template-generator";
import { createMockMigrationDiff } from "./test-helpers/migration-diff";

describe("template-generator", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "migration-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createTestSnapshot(
    types: SchemaSnapshot["types"] = {},
    namespace = "tailordb",
  ): SchemaSnapshot {
    return {
      version: SCHEMA_SNAPSHOT_VERSION,
      namespace,
      createdAt: new Date().toISOString(),
      types,
    };
  }

  async function writeExistingMigrateFile(migrationNumber: number) {
    const migrationDir = getMigrationDirPath(tempDir, migrationNumber);
    await fs.mkdir(migrationDir, { recursive: true });
    await fs.writeFile(
      path.join(migrationDir, MIGRATE_FILE_NAME),
      "export async function main() {}",
    );
  }

  describe("generateSchemaFile", () => {
    test("should generate initial schema snapshot file in directory structure", async () => {
      const snapshot = createTestSnapshot({
        User: {
          name: "User",
          pluralForm: "Users",
          fields: {
            name: { type: "string", required: true },
            email: { type: "string", required: false },
          },
        },
      });

      const result = await generateSchemaFile(snapshot, tempDir, 0);

      expect(result.migrationNumber).toBe(0);
      expect(result.filePath).toBe(path.join(tempDir, "0000", SCHEMA_FILE_NAME));

      const content = await fs.readFile(result.filePath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe(SCHEMA_SNAPSHOT_VERSION);
      expect(parsed.namespace).toBe("tailordb");
      expect(parsed.types.User.name).toBe("User");
    });

    test("should create nested directories if they do not exist", async () => {
      const nestedDir = path.join(tempDir, "nested", "migrations");
      const snapshot = createTestSnapshot();

      const result = await generateSchemaFile(snapshot, nestedDir, 0);

      expect(result.filePath).toContain(nestedDir);
      const exists = await fs
        .access(result.filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    test.each([
      [0, "0000"],
      [1, "0001"],
      [10, "0010"],
      [100, "0100"],
    ])("should use correct directory structure for migration %i", async (migrationNumber, dir) => {
      const snapshot = createTestSnapshot();

      const result = await generateSchemaFile(snapshot, tempDir, migrationNumber);

      expect(result.filePath).toBe(path.join(tempDir, dir, SCHEMA_FILE_NAME));
    });

    test("should throw error if schema file already exists", async () => {
      const snapshot = createTestSnapshot();

      await generateSchemaFile(snapshot, tempDir, 0);

      await expect(generateSchemaFile(snapshot, tempDir, 0)).rejects.toThrow(
        /Migration file already exists/,
      );
    });
  });

  describe("generateDiffFiles", () => {
    const previousSnapshot = createTestSnapshot({
      User: {
        name: "User",
        pluralForm: "Users",
        fields: {
          name: { type: "string", required: true },
        },
      },
    });

    test("should generate diff file without migration script for non-breaking changes", async () => {
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_added",
            typeName: "User",
            fieldName: "email",
            after: { type: "string", required: false },
          },
        ],
      });

      const result = await generateDiffFiles(diff, tempDir, 1, previousSnapshot);

      expect(result.migrationNumber).toBe(1);
      expect(result.diffFilePath).toBe(path.join(tempDir, "0001", DIFF_FILE_NAME));
      expect(result.migrateFilePath).toBeUndefined();
      expect(result.dbTypesFilePath).toBeUndefined();

      const content = await fs.readFile(result.diffFilePath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.changes).toHaveLength(1);
      expect(parsed.changes[0].kind).toBe("field_added");
    });

    test("should generate diff file with migration script and db types for breaking changes", async () => {
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_added",
            typeName: "User",
            fieldName: "email",
            after: { type: "string", required: true },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [{ typeName: "User", fieldName: "email", reason: "Required field added" }],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, previousSnapshot);

      expect(result.migrateFilePath).toBe(path.join(tempDir, "0001", MIGRATE_FILE_NAME));
      expect(result.dbTypesFilePath).toBe(path.join(tempDir, "0001", DB_TYPES_FILE_NAME));

      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      expect(scriptContent).toContain("export async function main");
      expect(scriptContent).toContain("Transaction");
      expect(scriptContent).toContain("email");

      const dbTypesContent = await fs.readFile(result.dbTypesFilePath!, "utf-8");
      expect(dbTypesContent).toContain("Transaction");
      expect(dbTypesContent).toContain("User");
    });

    test("should include description in diff file if provided", async () => {
      const diff = createMockMigrationDiff();

      const result = await generateDiffFiles(
        diff,
        tempDir,
        1,
        previousSnapshot,
        "add user email field",
      );

      const content = await fs.readFile(result.diffFilePath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.description).toBe("add user email field");
    });

    test("should not generate migration script for field removal", async () => {
      const snapshotWithOldField = createTestSnapshot({
        User: {
          name: "User",
          pluralForm: "Users",
          fields: {
            name: { type: "string", required: true },
            oldField: { type: "string", required: false },
          },
        },
      });

      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_removed",
            typeName: "User",
            fieldName: "oldField",
            before: { type: "string", required: false },
          },
        ],
      });

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithOldField);

      // migrate.ts is not generated for field removal
      expect(result.migrateFilePath).toBeUndefined();
      expect(result.dbTypesFilePath).toBeUndefined();
    });

    // Note: Type change and array-to-single-value change are rejected as unsupported in
    // generate.ts before reaching generateDiffFiles, so no test is needed for those cases here.

    test("should generate migration script for unique constraint addition", async () => {
      const snapshotWithoutUnique = createTestSnapshot({
        User: {
          name: "User",
          pluralForm: "Users",
          fields: {
            email: { type: "string", required: true, unique: false },
          },
        },
      });

      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_modified",
            typeName: "User",
            fieldName: "email",
            before: { type: "string", required: true, unique: false },
            after: { type: "string", required: true, unique: true },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          { typeName: "User", fieldName: "email", reason: "Unique constraint added to field" },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithoutUnique);

      expect(result.migrateFilePath).toBeDefined();

      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      expect(scriptContent).toContain("email");
      expect(scriptContent).toContain("unique");
    });

    test("should generate migration script for enum values removal", async () => {
      const allEnumValues = [
        { value: "PENDING" },
        { value: "IN_PROGRESS" },
        { value: "DONE" },
        { value: "CANCELLED" },
      ];
      const snapshotWithAllEnumValues = createTestSnapshot({
        Task: {
          name: "Task",
          pluralForm: "Tasks",
          fields: {
            status: { type: "enum", required: true, allowedValues: allEnumValues },
          },
        },
      });

      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_modified",
            typeName: "Task",
            fieldName: "status",
            before: { type: "enum", required: true, allowedValues: allEnumValues },
            after: {
              type: "enum",
              required: true,
              allowedValues: allEnumValues.slice(0, 3),
            },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          { typeName: "Task", fieldName: "status", reason: "Enum values removed: CANCELLED" },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithAllEnumValues);

      expect(result.migrateFilePath).toBeDefined();

      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      expect(scriptContent).toContain("status");
      expect(scriptContent).toContain("CANCELLED");
      expect(scriptContent).toContain("removed enum values");
    });

    test("should throw error if diff file already exists", async () => {
      const diff = createMockMigrationDiff();

      await generateDiffFiles(diff, tempDir, 1, previousSnapshot);

      await expect(generateDiffFiles(diff, tempDir, 1, previousSnapshot)).rejects.toThrow(
        /Migration file already exists/,
      );
    });

    test("should throw error if migrate file already exists for breaking changes", async () => {
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_added",
            typeName: "User",
            fieldName: "email",
            after: { type: "string", required: true },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [{ typeName: "User", fieldName: "email", reason: "Required field added" }],
        requiresMigrationScript: true,
      });

      await writeExistingMigrateFile(1);

      await expect(generateDiffFiles(diff, tempDir, 1, previousSnapshot)).rejects.toThrow(
        /Migration file already exists/,
      );
    });
  });

  describe("migrationScriptExists", () => {
    test("should return true if migration script exists in directory", async () => {
      await writeExistingMigrateFile(2);

      const exists = await migrationScriptExists(tempDir, 2);
      expect(exists).toBe(true);
    });

    test("should return false if migration script does not exist", async () => {
      const exists = await migrationScriptExists(tempDir, 999);
      expect(exists).toBe(false);
    });
  });

  describe("getMigrationScriptPath", () => {
    test.each([
      [1, "0001"],
      [2, "0002"],
      [10, "0010"],
      [100, "0100"],
    ])("should return correct path for migration number %i", (migrationNumber, dir) => {
      const result = getMigrationScriptPath(tempDir, migrationNumber);
      expect(result).toBe(path.join(tempDir, dir, MIGRATE_FILE_NAME));
    });
  });
});
