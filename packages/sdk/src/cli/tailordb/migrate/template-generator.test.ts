import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { SCHEMA_SNAPSHOT_VERSION, type MigrationDiff } from "./diff-calculator";
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

  describe("generateSchemaFile", () => {
    it("should generate initial schema snapshot file in directory structure", async () => {
      const snapshot = createTestSnapshot({
        User: {
          name: "User",
          fields: {
            name: { type: "string", required: true },
            email: { type: "string", required: false },
          },
        },
      });

      const result = await generateSchemaFile(snapshot, tempDir, 0);

      // Check result
      expect(result.migrationNumber).toBe(0);
      expect(result.filePath).toBe(path.join(tempDir, "0000", SCHEMA_FILE_NAME));

      // Check file was created
      const content = await fs.readFile(result.filePath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe(SCHEMA_SNAPSHOT_VERSION);
      expect(parsed.namespace).toBe("tailordb");
      expect(parsed.types.User.name).toBe("User");
    });

    it("should create nested directories if they do not exist", async () => {
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

    it("should use correct directory structure", async () => {
      const snapshot = createTestSnapshot();

      const result0 = await generateSchemaFile(snapshot, tempDir, 0);
      expect(result0.filePath).toBe(path.join(tempDir, "0000", SCHEMA_FILE_NAME));

      const result1 = await generateSchemaFile(snapshot, tempDir, 1);
      expect(result1.filePath).toBe(path.join(tempDir, "0001", SCHEMA_FILE_NAME));

      const result10 = await generateSchemaFile(snapshot, tempDir, 10);
      expect(result10.filePath).toBe(path.join(tempDir, "0010", SCHEMA_FILE_NAME));

      const result100 = await generateSchemaFile(snapshot, tempDir, 100);
      expect(result100.filePath).toBe(path.join(tempDir, "0100", SCHEMA_FILE_NAME));
    });

    it("should throw error if schema file already exists", async () => {
      const snapshot = createTestSnapshot();

      // Create the file first
      await generateSchemaFile(snapshot, tempDir, 0);

      // Attempt to create again should throw
      await expect(generateSchemaFile(snapshot, tempDir, 0)).rejects.toThrow(
        /Migration file already exists/,
      );
    });
  });

  describe("generateDiffFiles", () => {
    const previousSnapshot = createTestSnapshot({
      User: {
        name: "User",
        fields: {
          name: { type: "string", required: true },
        },
      },
    });

    it("should generate diff file without migration script for non-breaking changes", async () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace: "tailordb",
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_added",
            typeName: "User",
            fieldName: "email",
            after: { type: "string", required: false },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      const result = await generateDiffFiles(diff, tempDir, 1, previousSnapshot);

      expect(result.migrationNumber).toBe(1);
      expect(result.diffFilePath).toBe(path.join(tempDir, "0001", DIFF_FILE_NAME));
      expect(result.migrateFilePath).toBeUndefined();
      expect(result.dbTypesFilePath).toBeUndefined();

      // Check diff file content
      const content = await fs.readFile(result.diffFilePath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.changes).toHaveLength(1);
      expect(parsed.changes[0].kind).toBe("field_added");
    });

    it("should generate diff file with migration script and db types for breaking changes", async () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace: "tailordb",
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_added",
            typeName: "User",
            fieldName: "email",
            after: { type: "string", required: true },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            typeName: "User",
            fieldName: "email",
            reason: "Required field added",
          },
        ],
        requiresMigrationScript: true,
      };

      const result = await generateDiffFiles(diff, tempDir, 1, previousSnapshot);

      expect(result.migrateFilePath).toBe(path.join(tempDir, "0001", MIGRATE_FILE_NAME));
      expect(result.dbTypesFilePath).toBe(path.join(tempDir, "0001", DB_TYPES_FILE_NAME));

      // Check migration script content
      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      expect(scriptContent).toContain("export async function main");
      expect(scriptContent).toContain("Transaction");
      expect(scriptContent).toContain("email");

      // Check db types content
      const dbTypesContent = await fs.readFile(result.dbTypesFilePath!, "utf-8");
      expect(dbTypesContent).toContain("Transaction");
      expect(dbTypesContent).toContain("User");
    });

    it("should include description in diff file if provided", async () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace: "tailordb",
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

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

    it("should not generate migration script for field removal", async () => {
      const snapshotWithOldField = createTestSnapshot({
        User: {
          name: "User",
          fields: {
            name: { type: "string", required: true },
            oldField: { type: "string", required: false },
          },
        },
      });

      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace: "tailordb",
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_removed",
            typeName: "User",
            fieldName: "oldField",
            before: { type: "string", required: false },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithOldField);

      // migrate.ts is not generated for field removal
      expect(result.migrateFilePath).toBeUndefined();
      expect(result.dbTypesFilePath).toBeUndefined();
    });

    // Note: Type change is rejected as unsupported in generate.ts before reaching generateDiffFiles
    // No test needed here as the migration file will never be generated for this case

    // Note: Array to single value change is rejected as unsupported in generate.ts before reaching generateDiffFiles
    // No test needed here as the migration file will never be generated for this case

    it("should generate migration script for unique constraint addition", async () => {
      const snapshotWithoutUnique = createTestSnapshot({
        User: {
          name: "User",
          fields: {
            email: { type: "string", required: true, unique: false },
          },
        },
      });

      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace: "tailordb",
        createdAt: new Date().toISOString(),
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
          {
            typeName: "User",
            fieldName: "email",
            reason: "Unique constraint added to field",
          },
        ],
        requiresMigrationScript: true,
      };

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithoutUnique);

      expect(result.migrateFilePath).toBeDefined();

      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      expect(scriptContent).toContain("email");
      expect(scriptContent).toContain("unique");
    });

    it("should generate migration script for enum values removal", async () => {
      const snapshotWithAllEnumValues = createTestSnapshot({
        Task: {
          name: "Task",
          fields: {
            status: {
              type: "enum",
              required: true,
              allowedValues: ["PENDING", "IN_PROGRESS", "DONE", "CANCELLED"],
            },
          },
        },
      });

      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace: "tailordb",
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_modified",
            typeName: "Task",
            fieldName: "status",
            before: {
              type: "enum",
              required: true,
              allowedValues: ["PENDING", "IN_PROGRESS", "DONE", "CANCELLED"],
            },
            after: {
              type: "enum",
              required: true,
              allowedValues: ["PENDING", "IN_PROGRESS", "DONE"],
            },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            typeName: "Task",
            fieldName: "status",
            reason: "Enum values removed: CANCELLED",
          },
        ],
        requiresMigrationScript: true,
      };

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithAllEnumValues);

      expect(result.migrateFilePath).toBeDefined();

      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      expect(scriptContent).toContain("status");
      expect(scriptContent).toContain("CANCELLED");
      expect(scriptContent).toContain("removed enum values");
    });

    it("should throw error if diff file already exists", async () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace: "tailordb",
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      // Create the file first
      await generateDiffFiles(diff, tempDir, 1, previousSnapshot);

      // Attempt to create again should throw
      await expect(generateDiffFiles(diff, tempDir, 1, previousSnapshot)).rejects.toThrow(
        /Migration file already exists/,
      );
    });

    it("should throw error if migrate file already exists for breaking changes", async () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace: "tailordb",
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_added",
            typeName: "User",
            fieldName: "email",
            after: { type: "string", required: true },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            typeName: "User",
            fieldName: "email",
            reason: "Required field added",
          },
        ],
        requiresMigrationScript: true,
      };

      // Create the migrate file manually in directory structure
      const migrationDir = getMigrationDirPath(tempDir, 1);
      await fs.mkdir(migrationDir, { recursive: true });
      await fs.writeFile(
        path.join(migrationDir, MIGRATE_FILE_NAME),
        "export async function main() {}",
      );

      // Attempt to create should throw because migrate file exists
      await expect(generateDiffFiles(diff, tempDir, 1, previousSnapshot)).rejects.toThrow(
        /Migration file already exists/,
      );
    });
  });

  describe("migrationScriptExists", () => {
    it("should return true if migration script exists in directory", async () => {
      // Create a migrate file in directory structure
      const migrationDir = getMigrationDirPath(tempDir, 2);
      await fs.mkdir(migrationDir, { recursive: true });
      await fs.writeFile(
        path.join(migrationDir, MIGRATE_FILE_NAME),
        "export async function main() {}",
      );

      const exists = await migrationScriptExists(tempDir, 2);
      expect(exists).toBe(true);
    });

    it("should return false if migration script does not exist", async () => {
      const exists = await migrationScriptExists(tempDir, 999);
      expect(exists).toBe(false);
    });
  });

  describe("getMigrationScriptPath", () => {
    it("should return correct path for migration script in directory structure", () => {
      const result = getMigrationScriptPath(tempDir, 2);
      expect(result).toBe(path.join(tempDir, "0002", MIGRATE_FILE_NAME));
    });

    it("should handle different migration numbers", () => {
      expect(getMigrationScriptPath(tempDir, 1)).toBe(
        path.join(tempDir, "0001", MIGRATE_FILE_NAME),
      );
      expect(getMigrationScriptPath(tempDir, 10)).toBe(
        path.join(tempDir, "0010", MIGRATE_FILE_NAME),
      );
      expect(getMigrationScriptPath(tempDir, 100)).toBe(
        path.join(tempDir, "0100", MIGRATE_FILE_NAME),
      );
    });
  });
});
