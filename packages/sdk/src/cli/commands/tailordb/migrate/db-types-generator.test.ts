import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test, aroundEach, aroundAll } from "vitest";
import { writeDbTypesFile } from "./db-types-generator";
import { SCHEMA_SNAPSHOT_VERSION, type MigrationDiff } from "./diff-calculator";
import {
  formatMigrationNumber,
  getMigrationDirPath,
  type SchemaSnapshot,
  type SnapshotFieldConfig,
} from "./snapshot";
import { createMockMigrationDiff } from "./test-helpers/migration-diff";

const TEST_MIGRATIONS_BASE = path.join(__dirname, "__test_db_types__");

function createMigrationDir(baseDir: string, migrationNumber: number): void {
  const migDir = getMigrationDirPath(baseDir, migrationNumber);
  fs.mkdirSync(migDir, { recursive: true });
}

function createMockSnapshot(
  types: Record<
    string,
    {
      fields: Record<string, Partial<SnapshotFieldConfig>>;
    }
  >,
  namespace = "tailordb",
): SchemaSnapshot {
  const snapshotTypes: SchemaSnapshot["tables"] = {};
  for (const [tableName, typeConfig] of Object.entries(types)) {
    const fields: Record<string, SnapshotFieldConfig> = {};
    for (const [fieldName, fieldConfig] of Object.entries(typeConfig.fields)) {
      fields[fieldName] = {
        type: "string",
        required: false,
        ...fieldConfig,
      };
    }
    snapshotTypes[tableName] = {
      name: tableName,
      pluralForm: `${tableName}s`,
      fields,
    };
  }

  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace,
    createdAt: new Date().toISOString(),
    tables: snapshotTypes,
  };
}

describe("db-types-generator", () => {
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

  async function generateContent(
    snapshot: SchemaSnapshot,
    migrationNumber = 1,
    diff?: MigrationDiff,
  ): Promise<{ filePath: string; content: string }> {
    createMigrationDir(testDir, migrationNumber);
    const filePath = await writeDbTypesFile(snapshot, testDir, migrationNumber, diff);
    const content = fs.readFileSync(filePath, "utf-8");
    return { filePath, content };
  }

  test("generates empty db types when no tables in snapshot", async () => {
    const snapshot = createMockSnapshot({}, "tailordb");

    const { filePath, content } = await generateContent(snapshot);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(content).toContain("Auto-generated Kysely types");
    expect(content).toContain("Namespace: tailordb");
    expect(content).toContain("export interface Database {}");
    expect(content).toContain("export type Transaction = KyselyTransaction<Database>");
    // env-aware migration context type (inlines TailorEnv via the exported Env)
    expect(content).toContain('import type { Env } from "@tailor-platform/sdk"');
    expect(content).toContain("export type MigrationContext = {");
    expect(content).toContain(
      "env: keyof Env extends never ? Record<string, string | number | boolean> : Env;",
    );
  });

  type BasicFieldTypesCase = {
    testName: string;
    tableName: string;
    fields: Record<string, Partial<SnapshotFieldConfig>>;
    expectedContains: string[];
  };

  describe("writeDbTypesFile with basic field types", () => {
    test.each<BasicFieldTypesCase>([
      {
        testName: "generates types with string fields",
        tableName: "User",
        fields: {
          name: { type: "string", required: true },
          email: { type: "string", required: false },
        },
        expectedContains: [
          "export interface Database {",
          "User: {",
          "name: string;",
          "email: string | null;",
        ],
      },
      {
        testName: "generates types with number fields (integer, float)",
        tableName: "Product",
        fields: {
          quantity: { type: "integer", required: true },
          price: { type: "float", required: true },
          discount: { type: "number", required: false },
        },
        expectedContains: ["quantity: number;", "price: number;", "discount: number | null;"],
      },
      {
        testName: "generates types with boolean fields",
        tableName: "Settings",
        fields: {
          isActive: { type: "boolean", required: true },
          isVerified: { type: "bool", required: false },
        },
        expectedContains: ["isActive: boolean;", "isVerified: boolean | null;"],
      },
      {
        testName: "generates types with uuid fields",
        tableName: "Entity",
        fields: {
          externalId: { type: "uuid", required: true },
          referenceId: { type: "uuid", required: false },
        },
        expectedContains: ["externalId: string;", "referenceId: string | null;"],
      },
      {
        testName: "generates Timestamps for date and datetime alike",
        tableName: "Event",
        fields: {
          eventDate: { type: "date", required: true },
          startTime: { type: "datetime", required: true },
          endTime: { type: "datetime", required: false },
        },
        expectedContains: [
          "type Timestamp = ColumnType<Date, Date | string, Date | string>;",
          "eventDate: Timestamp;",
          "startTime: Timestamp;",
          "endTime: Timestamp | null;",
        ],
      },
    ])("$testName", async ({ tableName, fields, expectedContains }) => {
      const snapshot = createMockSnapshot({ [tableName]: { fields } });

      const { content } = await generateContent(snapshot);

      for (const expected of expectedContains) {
        expect(content).toContain(expected);
      }
    });
  });

  describe("writeDbTypesFile with array fields", () => {
    test("generates types with array fields", async () => {
      const snapshot = createMockSnapshot({
        Document: {
          fields: {
            tags: { type: "string", required: true, array: true },
            scores: { type: "integer", required: false, array: true },
          },
        },
      });

      const { content } = await generateContent(snapshot);

      expect(content).toContain("tags: string[];");
      expect(content).toContain("scores: number[] | null;");
    });
  });

  describe("writeDbTypesFile with enum fields", () => {
    test("generates types with enum fields and allowed values", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            status: {
              type: "enum",
              required: true,
              allowedValues: [{ value: "ACTIVE" }, { value: "INACTIVE" }, { value: "PENDING" }],
            },
            role: {
              type: "enum",
              required: false,
              allowedValues: [{ value: "ADMIN" }, { value: "USER" }],
            },
          },
        },
      });

      const { content } = await generateContent(snapshot);

      expect(content).toContain('"ACTIVE" | "INACTIVE" | "PENDING"');
      expect(content).toContain('"ADMIN" | "USER"');
    });

    test("generates types with enum array fields", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            roles: {
              type: "enum",
              required: true,
              array: true,
              allowedValues: [{ value: "ADMIN" }, { value: "USER" }, { value: "GUEST" }],
            },
          },
        },
      });

      const { content } = await generateContent(snapshot);

      // Enum array should have parentheses
      expect(content).toContain('("ADMIN" | "USER" | "GUEST")[]');
    });
  });

  describe("writeDbTypesFile with Generated id field", () => {
    test("always includes Generated id field", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            name: { type: "string", required: true },
          },
        },
      });

      const { content } = await generateContent(snapshot);

      expect(content).toContain("id: Generated<string>;");
      expect(content).toContain(
        "type Generated<T> = T extends ColumnType<infer S, infer I, infer U>",
      );
    });
  });

  describe("writeDbTypesFile with multiple tables", () => {
    test("generates types for multiple tables", async () => {
      const snapshot = createMockSnapshot({
        User: { fields: { name: { type: "string", required: true } } },
        Order: { fields: { total: { type: "float", required: true } } },
        Product: { fields: { sku: { type: "string", required: true } } },
      });

      const { content } = await generateContent(snapshot);

      expect(content).toContain("User: {");
      expect(content).toContain("Order: {");
      expect(content).toContain("Product: {");
    });
  });

  describe("writeDbTypesFile with breaking changes (diff)", () => {
    test("generates ColumnType for optional to required change", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            name: { type: "string", required: true },
            // This field was optional and is now required
            email: { type: "string", required: true },
          },
        },
      });
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_modified",
            tableName: "User",
            fieldName: "email",
            before: { type: "string", required: false },
            after: { type: "string", required: true },
          },
        ],
        hasBreakingChanges: true,
        requiresMigrationScript: true,
      });

      const { content } = await generateContent(snapshot, 1, diff);

      // Should generate ColumnType for optional->required field
      // SELECT returns T | null (existing data might be null)
      // INSERT/UPDATE requires T (must provide a value)
      expect(content).toContain("email: ColumnType<string | null, string, string>;");
    });

    test("generates ColumnType for optional to required datetime change", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            updatedAt: { type: "datetime", required: true },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_modified",
            tableName: "User",
            fieldName: "updatedAt",
            before: { type: "datetime", required: false },
            after: { type: "datetime", required: true },
          },
        ],
        hasBreakingChanges: true,
        requiresMigrationScript: true,
      });

      const filePath = await writeDbTypesFile(snapshot, testDir, 1, diff);
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain(
        "updatedAt: ColumnType<Date | null, Date | string, Date | string>;",
      );
    });

    test("generates ColumnType for optional to required date change", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            birthDate: { type: "date", required: true },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_modified",
            tableName: "User",
            fieldName: "birthDate",
            before: { type: "date", required: false },
            after: { type: "date", required: true },
          },
        ],
        hasBreakingChanges: true,
        requiresMigrationScript: true,
      });

      const filePath = await writeDbTypesFile(snapshot, testDir, 1, diff);
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain(
        "birthDate: ColumnType<Date | null, Date | string, Date | string>;",
      );
    });

    test("generates ColumnType for added required fields", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            name: { type: "string", required: true },
          },
        },
      });
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_added",
            tableName: "User",
            fieldName: "role",
            after: { type: "string", required: true },
          },
        ],
        hasBreakingChanges: true,
        requiresMigrationScript: true,
      });

      const { content } = await generateContent(snapshot, 1, diff);

      // Added required field should be treated like optional->required
      expect(content).toContain("role: ColumnType<string | null, string, string>;");
    });

    test("injects the new table for a rename alongside the old one", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            email: { type: "string", required: false },
          },
        },
      });
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "table_renamed",
            tableName: "Person",
            previousTableName: "User",
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
        requiresMigrationScript: true,
      });

      const { content } = await generateContent(snapshot, 1, diff);

      expect(content).toContain("User: {");
      expect(content).toContain("Person: {");
      const personBlock = content.slice(content.indexOf("Person: {"));
      expect(personBlock).toContain("id: Generated<string>;");
      expect(personBlock).toContain("email: string | null;");
    });

    test("injects a renamed table even when the previous snapshot is empty", async () => {
      const snapshot = createMockSnapshot({}, "tailordb");
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "table_renamed",
            tableName: "Person",
            previousTableName: "User",
            before: { name: "User", pluralForm: "Users", fields: {} },
            after: { name: "Person", pluralForm: "People", fields: {} },
          },
        ],
        hasBreakingChanges: true,
        requiresMigrationScript: true,
      });

      const { content } = await generateContent(snapshot, 1, diff);

      expect(content).not.toContain("export interface Database {}");
      expect(content).toContain("Person: {");
    });

    test("generates ColumnType for enum value changes", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            status: {
              type: "enum",
              required: true,
              allowedValues: [{ value: "ACTIVE" }, { value: "INACTIVE" }],
            },
          },
        },
      });
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_modified",
            tableName: "User",
            fieldName: "status",
            before: {
              type: "enum",
              required: true,
              allowedValues: [{ value: "ACTIVE" }, { value: "INACTIVE" }, { value: "PENDING" }],
            },
            after: {
              type: "enum",
              required: true,
              allowedValues: [{ value: "ACTIVE" }, { value: "INACTIVE" }],
            },
          },
        ],
        hasBreakingChanges: true,
        requiresMigrationScript: true,
      });

      const { content } = await generateContent(snapshot, 1, diff);

      // Should generate ColumnType with all values for SELECT, only after values for INSERT/UPDATE
      expect(content).toContain("ColumnType<");
      expect(content).toContain('"ACTIVE" | "INACTIVE" | "PENDING"'); // SELECT type (all values)
      expect(content).toContain('"ACTIVE" | "INACTIVE"'); // INSERT/UPDATE type (only after values)
    });

    test("handles enum value changes with nullable fields", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            status: {
              type: "enum",
              required: false,
              allowedValues: [{ value: "ACTIVE" }, { value: "INACTIVE" }],
            },
          },
        },
      });
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_modified",
            tableName: "User",
            fieldName: "status",
            before: {
              type: "enum",
              required: false,
              allowedValues: [{ value: "ACTIVE" }, { value: "INACTIVE" }, { value: "PENDING" }],
            },
            after: {
              type: "enum",
              required: false,
              allowedValues: [{ value: "ACTIVE" }, { value: "INACTIVE" }],
            },
          },
        ],
        hasBreakingChanges: true,
        requiresMigrationScript: true,
      });

      const { content } = await generateContent(snapshot, 1, diff);

      // Should include null in all parts
      expect(content).toContain("| null");
    });

    test("handles enum value changes with array fields", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            roles: {
              type: "enum",
              required: true,
              array: true,
              allowedValues: [{ value: "ADMIN" }, { value: "USER" }],
            },
          },
        },
      });
      const diff = createMockMigrationDiff({
        changes: [
          {
            kind: "field_modified",
            tableName: "User",
            fieldName: "roles",
            before: {
              type: "enum",
              required: true,
              array: true,
              allowedValues: [{ value: "ADMIN" }, { value: "USER" }, { value: "GUEST" }],
            },
            after: {
              type: "enum",
              required: true,
              array: true,
              allowedValues: [{ value: "ADMIN" }, { value: "USER" }],
            },
          },
        ],
        hasBreakingChanges: true,
        requiresMigrationScript: true,
      });

      const { content } = await generateContent(snapshot, 1, diff);

      // Should generate array type with ColumnType
      expect(content).toContain("ColumnType<");
      expect(content).toContain("[]");
    });
  });

  describe("writeDbTypesFile file location", () => {
    test("writes file to correct location", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            name: { type: "string", required: true },
          },
        },
      });
      const migrationNumber = 5;

      const { filePath } = await generateContent(snapshot, migrationNumber);

      const expectedPath = path.join(testDir, formatMigrationNumber(migrationNumber), "db.ts");
      expect(filePath).toBe(expectedPath);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});
