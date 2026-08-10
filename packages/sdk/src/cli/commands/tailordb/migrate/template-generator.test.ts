import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "pathe";
import ts from "typescript";
import { describe, expect, test, aroundEach } from "vitest";
import { SCHEMA_SNAPSHOT_VERSION } from "./diff-calculator";
import {
  SCHEMA_FILE_NAME,
  DIFF_FILE_NAME,
  MIGRATE_FILE_NAME,
  DB_TYPES_FILE_NAME,
  compareSnapshots,
  getMigrationDirPath,
  normalizeSchemaSnapshot,
  type SchemaSnapshot,
} from "./snapshot";
import {
  generateSchemaFile,
  generateDiffFiles,
  generateMigrationTestScript,
  migrationScriptExists,
  getMigrationScriptPath,
} from "./template-generator";
import { createMockMigrationDiff } from "./test-helpers/migration-diff";

const packageRoot = path.resolve(import.meta.dirname, "../../../../..");

function getTypeScriptDiagnostics(
  filePath: string,
): readonly { code: number; messageText: string }[] {
  const program = ts.createProgram([filePath], {
    baseUrl: packageRoot,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    paths: {
      "@tailor-platform/sdk": ["src/configure/index.ts"],
      "@tailor-platform/sdk/kysely": ["src/kysely/index.ts"],
    },
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  });

  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === filePath)
    .map((diagnostic) => ({
      code: diagnostic.code,
      messageText: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    }));
}

describe("template-generator", () => {
  let tempDir: string;

  aroundEach(async (runTest) => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "migration-test-"));
    await runTest();
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

    test("should generate an unconditional batched copy script for field renames", async () => {
      const renamePreviousSnapshot = createTestSnapshot({
        User: {
          name: "User",
          pluralForm: "Users",
          fields: {
            fullName: { type: "string", required: false },
          },
        },
      });
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_renamed",
            typeName: "User",
            fieldName: "displayName",
            previousFieldName: "fullName",
            before: { type: "string", required: false },
            after: { type: "string", required: false },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            typeName: "User",
            fieldName: "displayName",
            reason: "Field renamed from fullName to displayName",
          },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, renamePreviousSnapshot);

      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      expect(scriptContent).toContain("Copy User.fullName into displayName for every row");
      expect(scriptContent).toContain('.set((eb) => ({ displayName: eb.ref("fullName") }))');
      // Unconditional copy: no filter on the source field
      expect(scriptContent).not.toContain(".where(");
      expect(scriptContent).not.toContain("No data migration needed");

      const dbTypesContent = await fs.readFile(result.dbTypesFilePath!, "utf-8");
      expect(dbTypesContent).toContain("fullName: string | null;");
      expect(dbTypesContent).toContain("displayName: string | null;");
    });

    test("should add a duplicate-resolution block when a rename target gains unique", async () => {
      const renamePreviousSnapshot = createTestSnapshot({
        User: {
          name: "User",
          pluralForm: "Users",
          fields: {
            fullName: { type: "string", required: false },
          },
        },
      });
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_renamed",
            typeName: "User",
            fieldName: "displayName",
            previousFieldName: "fullName",
            before: { type: "string", required: false },
            after: { type: "string", required: false, unique: true },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            typeName: "User",
            fieldName: "displayName",
            reason: "Field renamed from fullName to displayName",
          },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, renamePreviousSnapshot);

      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      const copyPosition = scriptContent.indexOf('eb.ref("fullName")');
      const dedupePosition = scriptContent.indexOf(
        "Ensure displayName values are unique before adding constraint",
      );
      expect(copyPosition).toBeGreaterThan(-1);
      expect(dedupePosition).toBeGreaterThan(copyPosition);
    });

    test.each([
      ["decreases", 2, true],
      ["keeps", 3, false],
    ])(
      "unique-to-unique decimal rename that %s scale adds a dedupe block: %s",
      async (_label, afterScale, expectDedupe) => {
        const renamePreviousSnapshot = createTestSnapshot({
          Item: {
            name: "Item",
            pluralForm: "Items",
            fields: {
              price: { type: "decimal", required: true, unique: true, scale: 3 },
            },
          },
        });
        const diff = createMockMigrationDiff({
          changes: [
            {
              kind: "field_renamed",
              typeName: "Item",
              fieldName: "unitPrice",
              previousFieldName: "price",
              before: { type: "decimal", required: true, unique: true, scale: 3 },
              after: { type: "decimal", required: true, unique: true, scale: afterScale },
            },
          ],
          hasBreakingChanges: true,
          breakingChanges: [
            {
              typeName: "Item",
              fieldName: "unitPrice",
              reason: "Field renamed from price to unitPrice",
            },
          ],
          requiresMigrationScript: true,
        });

        const result = await generateDiffFiles(diff, tempDir, 1, renamePreviousSnapshot);

        const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
        expect(scriptContent).toContain('eb.ref("price")');
        expect(
          scriptContent.includes("Ensure unitPrice values are unique before adding constraint"),
        ).toBe(expectDedupe);
      },
    );

    test.each([
      ["decreases", 2, true],
      ["keeps", 3, false],
    ])(
      "decimal rename copy that %s scale includes a rounding warning: %s",
      async (_label, afterScale, expectWarning) => {
        const renamePreviousSnapshot = createTestSnapshot({
          Item: {
            name: "Item",
            pluralForm: "Items",
            fields: {
              ratio: { type: "decimal", required: false, scale: 3 },
            },
          },
        });
        const diff = createMockMigrationDiff({
          changes: [
            {
              kind: "field_renamed",
              typeName: "Item",
              fieldName: "rate",
              previousFieldName: "ratio",
              before: { type: "decimal", required: false, scale: 3 },
              after: { type: "decimal", required: false, scale: afterScale },
            },
          ],
          hasBreakingChanges: true,
          breakingChanges: [
            {
              typeName: "Item",
              fieldName: "rate",
              reason: "Field renamed from ratio to rate",
            },
          ],
          requiresMigrationScript: true,
        });

        const result = await generateDiffFiles(diff, tempDir, 1, renamePreviousSnapshot);

        const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
        expect(scriptContent).toContain('eb.ref("ratio")');
        expect(scriptContent.includes("WARNING: rate has a smaller decimal scale than ratio")).toBe(
          expectWarning,
        );
      },
    );

    test("should add a null-handling TODO when a rename target becomes required", async () => {
      const renamePreviousSnapshot = createTestSnapshot({
        User: {
          name: "User",
          pluralForm: "Users",
          fields: {
            fullName: { type: "string", required: false },
          },
        },
      });
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_renamed",
            typeName: "User",
            fieldName: "displayName",
            previousFieldName: "fullName",
            before: { type: "string", required: false },
            after: { type: "string", required: true },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            typeName: "User",
            fieldName: "displayName",
            reason: "Field renamed from fullName to displayName",
          },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, renamePreviousSnapshot);

      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      expect(scriptContent).toContain("TODO: fullName is optional but displayName is required");
      expect(scriptContent).toContain('.set((eb) => ({ displayName: eb.ref("fullName") }))');

      const dbTypesContent = await fs.readFile(result.dbTypesFilePath!, "utf-8");
      expect(dbTypesContent).toContain("displayName: ColumnType<string | null, string, string>;");
    });

    test("should generate an id-preserving batched copy script for type renames", async () => {
      const renamePreviousSnapshot = createTestSnapshot({
        User: {
          name: "User",
          pluralForm: "Users",
          fields: {
            email: { type: "string", required: false },
          },
        },
      });
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "type_renamed",
            typeName: "Person",
            previousTypeName: "User",
            before: {
              name: "User",
              pluralForm: "Users",
              fields: { email: { type: "string", required: false } },
            },
            after: {
              name: "Person",
              pluralForm: "People",
              fields: { email: { type: "string", required: false } },
            },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [{ typeName: "Person", reason: "Type renamed from User to Person" }],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, renamePreviousSnapshot);

      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      expect(scriptContent).toContain("Copy every User row into Person, preserving ids");
      expect(scriptContent).toContain('.selectFrom("User")');
      expect(scriptContent).toContain(".selectAll()");
      expect(scriptContent).toContain('.orderBy("id", "asc")');
      expect(scriptContent).toContain(".limit(100)");
      expect(scriptContent).toContain('trx.insertInto("Person").values(rows).execute()');
      expect(scriptContent).not.toContain("No data migration needed");

      const dbTypesContent = await fs.readFile(result.dbTypesFilePath!, "utf-8");
      expect(dbTypesContent).toContain("User: {");
      expect(dbTypesContent).toContain("Person: {");

      expect(getTypeScriptDiagnostics(result.migrateFilePath!)).toEqual([]);
    }, 15_000);

    test("should not scaffold a reference fixup for a retarget that follows a type rename", async () => {
      const renamePreviousSnapshot = createTestSnapshot({
        User: {
          name: "User",
          pluralForm: "Users",
          fields: {},
        },
        Order: {
          name: "Order",
          pluralForm: "Orders",
          fields: {
            ownerId: {
              type: "uuid",
              required: false,
              foreignKey: true,
              foreignKeyType: "User",
              foreignKeyField: "id",
            },
          },
        },
      });
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "type_renamed",
            typeName: "Person",
            previousTypeName: "User",
            before: { name: "User", pluralForm: "Users", fields: {} },
            after: { name: "Person", pluralForm: "People", fields: {} },
          },
          {
            kind: "field_modified",
            typeName: "Order",
            fieldName: "ownerId",
            before: {
              type: "uuid",
              required: false,
              foreignKey: true,
              foreignKeyType: "User",
              foreignKeyField: "id",
            },
            after: {
              type: "uuid",
              required: false,
              foreignKey: true,
              foreignKeyType: "Person",
              foreignKeyField: "id",
            },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [{ typeName: "Person", reason: "Type renamed from User to Person" }],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, renamePreviousSnapshot);

      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      expect(scriptContent).toContain('trx.insertInto("Person")');
      expect(scriptContent).not.toContain("Migrate ownerId references");
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

    test("should scaffold a batched normalization for a compatible field type change", async () => {
      const snapshotWithIntegerAge = createTestSnapshot({
        User: {
          name: "User",
          pluralForm: "Users",
          fields: {
            age: { type: "integer", required: false },
          },
        },
      });

      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_type_modified",
            typeName: "User",
            fieldName: "age",
            before: { type: "integer", required: false },
            after: { type: "float", required: false },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            typeName: "User",
            fieldName: "age",
            reason: "Field type changed from integer to float",
          },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithIntegerAge);

      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      expect(scriptContent).toContain("Normalize User.age from integer to float");
      expect(scriptContent).toContain('.where("age", "is not", null)');
      expect(scriptContent).toContain('.orderBy("id", "asc")');
      expect(scriptContent).toContain(".limit(100)");
      expect(scriptContent).toContain("const sourceValue = row.age");
      expect(scriptContent).toContain("if (sourceValue === null) continue");
      expect(scriptContent).toContain("const normalizedValue: never = sourceValue");
      expect(scriptContent).toContain(
        "TODO(tailor-migration-review): Remove this marker and the `never` annotation after reviewing the normalization",
      );
      expect(scriptContent).toContain(
        "Keep the value accepted by the active integer type and castable to float",
      );
      expect(scriptContent).toContain("if (Object.is(normalizedValue, sourceValue)) continue");
      expect(scriptContent).toContain('.set({ ["age"]: normalizedValue })');

      const unresolvedDiagnostics = getTypeScriptDiagnostics(result.migrateFilePath!);
      expect(unresolvedDiagnostics).toEqual([
        expect.objectContaining({
          code: 2322,
          messageText: "Type 'number' is not assignable to type 'never'.",
        }),
      ]);

      await fs.writeFile(
        result.migrateFilePath!,
        scriptContent.replace("const normalizedValue: never", "const normalizedValue"),
      );
      expect(getTypeScriptDiagnostics(result.migrateFilePath!)).toEqual([]);
    }, 15_000);

    test("should use a data property when normalizing a field named __proto__", async () => {
      const snapshot = createTestSnapshot({
        User: {
          name: "User",
          pluralForm: "Users",
          fields: Object.fromEntries([["__proto__", { type: "integer", required: false }]]),
        },
      });
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_type_modified",
            typeName: "User",
            fieldName: "__proto__",
            before: { type: "integer", required: false },
            after: { type: "float", required: false },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            typeName: "User",
            fieldName: "__proto__",
            reason: "Field type changed from integer to float",
          },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, snapshot);
      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");

      expect(scriptContent).toContain('.set({ ["__proto__"]: normalizedValue })');
    });

    test("should fail closed on unresolved duplicates when a type change adds unique", async () => {
      const snapshotWithIntegerAge = createTestSnapshot({
        User: {
          name: "User",
          pluralForm: "Users",
          fields: {
            age: { type: "integer", required: false, unique: false },
          },
        },
      });
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_type_modified",
            typeName: "User",
            fieldName: "age",
            before: { type: "integer", required: false, unique: false },
            after: { type: "float", required: false, unique: true },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            typeName: "User",
            fieldName: "age",
            reason: "Field type changed from integer to float",
          },
          {
            typeName: "User",
            fieldName: "age",
            reason: "Unique constraint added to field",
          },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithIntegerAge);
      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");

      expect(scriptContent).toContain("Normalize User.age from integer to float");
      expect(scriptContent).toContain(
        "TODO: Resolve duplicate User.age values before adding the unique constraint",
      );
    });

    // Array-to-single-value changes remain unsupported until rename-based
    // expand-contract migrations are available.

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

    test("should generate migration script for unique index addition", async () => {
      const snapshotWithoutIndex = createTestSnapshot({
        User: {
          name: "User",
          pluralForm: "Users",
          fields: {
            name: { type: "string", required: true },
            org: { type: "string", required: true },
          },
        },
      });

      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "index_added",
            typeName: "User",
            indexName: "name_org",
            after: { fields: ["name", "org"], unique: true },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          { typeName: "User", reason: 'Unique constraint added to index "name_org"' },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithoutIndex);

      expect(result.migrateFilePath).toBeDefined();

      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      expect(scriptContent).toContain('.groupBy(["name", "org"])');
      expect(scriptContent).toContain('.where("name", "=", dup.name)');
      expect(scriptContent).toContain('.where("org", "=", dup.org)');
      expect(scriptContent).not.toContain("No data migration needed");
    });

    test("should generate migration script when an existing index gains unique", async () => {
      const snapshotWithIndex = createTestSnapshot({
        User: {
          name: "User",
          pluralForm: "Users",
          fields: {
            name: { type: "string", required: true },
          },
          indexes: {
            name_idx: { fields: ["name"], unique: false },
          },
        },
      });

      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "index_modified",
            typeName: "User",
            indexName: "name_idx",
            before: { fields: ["name"], unique: false },
            after: { fields: ["name"], unique: true },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          { typeName: "User", reason: 'Unique constraint added to index "name_idx"' },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithIndex);

      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      expect(scriptContent).toContain('.groupBy(["name"])');
      expect(scriptContent).not.toContain("No data migration needed");
    });

    test("should re-save decimal values before resolving unique index duplicates", async () => {
      const previous = createTestSnapshot({
        Item: {
          name: "Item",
          pluralForm: "Items",
          fields: {
            price: { type: "decimal", required: true, scale: 4 },
          },
        },
      });
      const current = createTestSnapshot({
        Item: {
          name: "Item",
          pluralForm: "Items",
          fields: {
            price: { type: "decimal", required: true, scale: 2 },
          },
          indexes: {
            price_idx: { fields: ["price"], unique: true },
          },
        },
      });
      const diff = compareSnapshots(
        normalizeSchemaSnapshot(previous),
        normalizeSchemaSnapshot(current),
      );

      const result = await generateDiffFiles(diff, tempDir, 1, previous);
      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      const decimalUpdatePosition = scriptContent.indexOf(".set({ price: row.price })");
      const indexDedupePosition = scriptContent.indexOf('.groupBy(["price"])');

      expect(decimalUpdatePosition).toBeGreaterThan(-1);
      expect(indexDedupePosition).toBeGreaterThan(-1);
      expect(decimalUpdatePosition).toBeLessThan(indexDedupePosition);
    });

    test("should scope unique migrations for multiple fields independently", async () => {
      const snapshotWithoutUnique = createTestSnapshot({
        User: {
          name: "User",
          pluralForm: "Users",
          fields: {
            email: { type: "string", required: true, unique: false },
            username: { type: "string", required: true, unique: false },
          },
        },
      });

      const diff = createMockMigrationDiff({
        changes: ["email", "username"].map((fieldName) => ({
          kind: "field_modified" as const,
          typeName: "User",
          fieldName,
          before: { type: "string" as const, required: true, unique: false },
          after: { type: "string" as const, required: true, unique: true },
        })),
        hasBreakingChanges: true,
        breakingChanges: [
          { typeName: "User", fieldName: "email", reason: "Unique constraint added to field" },
          {
            typeName: "User",
            fieldName: "username",
            reason: "Unique constraint added to field",
          },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithoutUnique);
      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");

      expect(scriptContent.match(/\{\n {4}const duplicates =/g) ?? []).toHaveLength(2);
    });

    test("should scope foreign key migrations for multiple fields independently", async () => {
      const snapshotWithOldReferences = createTestSnapshot({
        Order: {
          name: "Order",
          pluralForm: "Orders",
          fields: {
            parentId: {
              type: "uuid",
              required: true,
              foreignKeyType: "LegacyParent",
            },
            ownerId: {
              type: "uuid",
              required: true,
              foreignKeyType: "LegacyOwner",
            },
          },
        },
      });

      const changes = [
        { fieldName: "parentId", beforeType: "LegacyParent", afterType: "Parent" },
        { fieldName: "ownerId", beforeType: "LegacyOwner", afterType: "Owner" },
      ];
      const diff = createMockMigrationDiff({
        changes: changes.map(({ fieldName, beforeType, afterType }) => ({
          kind: "field_modified" as const,
          typeName: "Order",
          fieldName,
          before: { type: "uuid" as const, required: true, foreignKeyType: beforeType },
          after: { type: "uuid" as const, required: true, foreignKeyType: afterType },
        })),
        hasBreakingChanges: true,
        breakingChanges: changes.map(({ fieldName, beforeType, afterType }) => ({
          typeName: "Order",
          fieldName,
          reason: `Foreign key target changed from ${beforeType} to ${afterType}`,
        })),
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithOldReferences);
      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");

      expect(scriptContent.match(/\{\n {4}const orphanedRecords =/g) ?? []).toHaveLength(2);
    });

    test("should warn that decreasing decimal scale can round values", async () => {
      const snapshotWithScale4 = createTestSnapshot({
        Item: {
          name: "Item",
          pluralForm: "Items",
          fields: {
            price: { type: "decimal", required: true, scale: 4 },
          },
        },
      });

      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_modified",
            typeName: "Item",
            fieldName: "price",
            before: { type: "decimal", required: true, scale: 4 },
            after: { type: "decimal", required: true, scale: 2 },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          { typeName: "Item", fieldName: "price", reason: "Decimal scale changed from 4 to 2" },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithScale4);

      expect(result.migrateFilePath).toBeDefined();

      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");
      expect(scriptContent).toContain('.selectFrom("Item")');
      expect(scriptContent).toContain('.where("price", "is not", null)');
      expect(scriptContent).toContain('.orderBy("id", "asc")');
      expect(scriptContent).toContain(".limit(100)");
      expect(scriptContent).toContain('.where("id", ">", lastId)');
      expect(scriptContent).toContain(".set({ price: row.price })");
      expect(scriptContent).toContain('.where("price", "=", row.price)');
      expect(scriptContent).toContain("platform-side");
      expect(scriptContent).toContain("WARNING: Values that exceed the new scale may be rounded");
      expect(scriptContent).not.toContain("No data migration needed");
    });

    test("should preserve optional-to-required migration when decimal scale also changes", async () => {
      const snapshotWithScale2 = createTestSnapshot({
        Item: {
          name: "Item",
          pluralForm: "Items",
          fields: {
            price: { type: "decimal", required: false, scale: 2 },
          },
        },
      });

      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_modified",
            typeName: "Item",
            fieldName: "price",
            before: { type: "decimal", required: false, scale: 2 },
            after: { type: "decimal", required: true, scale: 4 },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            typeName: "Item",
            fieldName: "price",
            reason: "Field changed from optional to required",
          },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithScale2);
      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");

      expect(scriptContent).toContain('.where("price", "is", null)');
      expect(scriptContent).toContain(".set({ price: row.price! })");
    });

    test("should preserve unique migration when decimal scale also changes", async () => {
      const snapshotWithScale4 = createTestSnapshot({
        Item: {
          name: "Item",
          pluralForm: "Items",
          fields: {
            price: { type: "decimal", required: true, unique: false, scale: 4 },
          },
        },
      });

      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_modified",
            typeName: "Item",
            fieldName: "price",
            before: { type: "decimal", required: true, unique: false, scale: 4 },
            after: { type: "decimal", required: true, unique: true, scale: 2 },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          { typeName: "Item", fieldName: "price", reason: "Unique constraint added to field" },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithScale4);
      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");

      expect(scriptContent).toContain("const duplicates");
      expect(scriptContent).toContain(".set({ price: row.price })");
      expect(scriptContent.indexOf(".set({ price: row.price })")).toBeLessThan(
        scriptContent.indexOf("const duplicates"),
      );
    });

    test("should preserve required, unique, and scale migrations on the same decimal field", async () => {
      const snapshotWithScale2 = createTestSnapshot({
        Item: {
          name: "Item",
          pluralForm: "Items",
          fields: {
            price: { type: "decimal", required: false, unique: false, scale: 2 },
          },
        },
      });

      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_modified",
            typeName: "Item",
            fieldName: "price",
            before: { type: "decimal", required: false, unique: false, scale: 2 },
            after: { type: "decimal", required: true, unique: true, scale: 4 },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            typeName: "Item",
            fieldName: "price",
            reason: "Field changed from optional to required",
          },
          { typeName: "Item", fieldName: "price", reason: "Unique constraint added to field" },
          { typeName: "Item", fieldName: "price", reason: "Decimal scale changed from 2 to 4" },
        ],
        requiresMigrationScript: true,
      });

      const result = await generateDiffFiles(diff, tempDir, 1, snapshotWithScale2);
      const scriptContent = await fs.readFile(result.migrateFilePath!, "utf-8");

      expect(scriptContent).toContain('.where("price", "is", null)');
      expect(scriptContent).toContain("const duplicates");
      expect(scriptContent).toContain(".set({ price: row.price! })");
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

  describe("generateMigrationTestScript", () => {
    test("should generate a test scaffold wired to the mock and generated types", () => {
      const script = generateMigrationTestScript(createMockMigrationDiff());

      expect(script).toContain('import { createKyselyMock } from "@tailor-platform/sdk/vitest"');
      expect(script).toContain('import { describe, expect, test } from "vitest"');
      expect(script).toContain('import type { Database } from "./db"');
      expect(script).toContain('import { main } from "./migrate"');
      expect(script).toContain("createKyselyMock<Database>()");
      expect(script).toContain("mock.withTx((trx) => main(trx))");
    });

    test("should snapshot both SQL and bind parameters by default", () => {
      const script = generateMigrationTestScript(createMockMigrationDiff());

      expect(script).toContain("sql: query.sql");
      expect(script).toContain("parameters: query.parameters");
    });

    test("should include the namespace in the suite name", () => {
      const script = generateMigrationTestScript(
        createMockMigrationDiff({ namespace: "analyticsdb" }),
      );

      expect(script).toContain('describe("analyticsdb migration"');
    });

    test("should escape the namespace in the suite name", () => {
      const script = generateMigrationTestScript(createMockMigrationDiff({ namespace: 'we"ird' }));

      expect(script).toContain('describe("we\\"ird migration"');
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
