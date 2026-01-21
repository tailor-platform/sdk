import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { writeDbTypesFile } from "./db-types-generator";
import { SCHEMA_SNAPSHOT_VERSION, type MigrationDiff } from "./diff-calculator";
import {
  formatMigrationNumber,
  getMigrationDirPath,
  type SchemaSnapshot,
  type SnapshotFieldConfig,
} from "./snapshot";

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
  const snapshotTypes: SchemaSnapshot["types"] = {};
  for (const [typeName, typeConfig] of Object.entries(types)) {
    const fields: Record<string, SnapshotFieldConfig> = {};
    for (const [fieldName, fieldConfig] of Object.entries(typeConfig.fields)) {
      fields[fieldName] = {
        type: "string",
        required: false,
        ...fieldConfig,
      };
    }
    snapshotTypes[typeName] = {
      name: typeName,
      fields,
    };
  }

  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace,
    createdAt: new Date().toISOString(),
    types: snapshotTypes,
  };
}

function createMockDiff(
  changes: MigrationDiff["changes"],
  options: Partial<Pick<MigrationDiff, "hasBreakingChanges" | "requiresMigrationScript">> = {},
): MigrationDiff {
  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: "tailordb",
    createdAt: new Date().toISOString(),
    changes,
    hasBreakingChanges: options.hasBreakingChanges ?? false,
    breakingChanges: [],
    requiresMigrationScript: options.requiresMigrationScript ?? false,
  };
}

describe("db-types-generator", () => {
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
  // writeDbTypesFile - Empty Types
  // ==========================================================================
  describe("writeDbTypesFile with empty types", () => {
    it("generates empty db types when no types in snapshot", async () => {
      const snapshot = createMockSnapshot({}, "tailordb");
      createMigrationDir(testDir, 1);

      const filePath = await writeDbTypesFile(snapshot, testDir, 1);

      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("Auto-generated Kysely types");
      expect(content).toContain("Namespace: tailordb");
      expect(content).toContain("interface Database {}");
      expect(content).toContain("export type Transaction = KyselyTransaction<Database>");
    });
  });

  // ==========================================================================
  // writeDbTypesFile - Basic Field Types
  // ==========================================================================
  describe("writeDbTypesFile with basic field types", () => {
    it("generates types with string fields", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            name: { type: "string", required: true },
            email: { type: "string", required: false },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const filePath = await writeDbTypesFile(snapshot, testDir, 1);
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("User: {");
      expect(content).toContain("name: string;");
      expect(content).toContain("email: string | null;");
    });

    it("generates types with number fields (integer, float)", async () => {
      const snapshot = createMockSnapshot({
        Product: {
          fields: {
            quantity: { type: "integer", required: true },
            price: { type: "float", required: true },
            discount: { type: "number", required: false },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const filePath = await writeDbTypesFile(snapshot, testDir, 1);
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("quantity: number;");
      expect(content).toContain("price: number;");
      expect(content).toContain("discount: number | null;");
    });

    it("generates types with boolean fields", async () => {
      const snapshot = createMockSnapshot({
        Settings: {
          fields: {
            isActive: { type: "boolean", required: true },
            isVerified: { type: "bool", required: false },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const filePath = await writeDbTypesFile(snapshot, testDir, 1);
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("isActive: boolean;");
      expect(content).toContain("isVerified: boolean | null;");
    });

    it("generates types with uuid fields", async () => {
      const snapshot = createMockSnapshot({
        Entity: {
          fields: {
            externalId: { type: "uuid", required: true },
            referenceId: { type: "uuid", required: false },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const filePath = await writeDbTypesFile(snapshot, testDir, 1);
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("externalId: string;");
      expect(content).toContain("referenceId: string | null;");
    });

    it("generates types with date/datetime fields using Timestamp", async () => {
      const snapshot = createMockSnapshot({
        Event: {
          fields: {
            eventDate: { type: "date", required: true },
            startTime: { type: "datetime", required: true },
            endTime: { type: "datetime", required: false },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const filePath = await writeDbTypesFile(snapshot, testDir, 1);
      const content = fs.readFileSync(filePath, "utf-8");

      // Should define Timestamp type
      expect(content).toContain("type Timestamp = ColumnType<Date, Date | string, Date | string>;");
      expect(content).toContain("eventDate: Timestamp;");
      expect(content).toContain("startTime: Timestamp;");
      expect(content).toContain("endTime: Timestamp | null;");
    });
  });

  // ==========================================================================
  // writeDbTypesFile - Array Fields
  // ==========================================================================
  describe("writeDbTypesFile with array fields", () => {
    it("generates types with array fields", async () => {
      const snapshot = createMockSnapshot({
        Document: {
          fields: {
            tags: { type: "string", required: true, array: true },
            scores: { type: "integer", required: false, array: true },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const filePath = await writeDbTypesFile(snapshot, testDir, 1);
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("tags: string[];");
      expect(content).toContain("scores: number[] | null;");
    });
  });

  // ==========================================================================
  // writeDbTypesFile - Enum Fields
  // ==========================================================================
  describe("writeDbTypesFile with enum fields", () => {
    it("generates types with enum fields and allowed values", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            status: {
              type: "enum",
              required: true,
              allowedValues: ["ACTIVE", "INACTIVE", "PENDING"],
            },
            role: {
              type: "enum",
              required: false,
              allowedValues: ["ADMIN", "USER"],
            },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const filePath = await writeDbTypesFile(snapshot, testDir, 1);
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain('"ACTIVE" | "INACTIVE" | "PENDING"');
      expect(content).toContain('"ADMIN" | "USER"');
    });

    it("generates types with enum array fields", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            roles: {
              type: "enum",
              required: true,
              array: true,
              allowedValues: ["ADMIN", "USER", "GUEST"],
            },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const filePath = await writeDbTypesFile(snapshot, testDir, 1);
      const content = fs.readFileSync(filePath, "utf-8");

      // Enum array should have parentheses
      expect(content).toContain('("ADMIN" | "USER" | "GUEST")[]');
    });
  });

  // ==========================================================================
  // writeDbTypesFile - Generated ID Field
  // ==========================================================================
  describe("writeDbTypesFile with Generated id field", () => {
    it("always includes Generated id field", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            name: { type: "string", required: true },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const filePath = await writeDbTypesFile(snapshot, testDir, 1);
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("id: Generated<string>;");
      expect(content).toContain(
        "type Generated<T> = T extends ColumnType<infer S, infer I, infer U>",
      );
    });
  });

  // ==========================================================================
  // writeDbTypesFile - Multiple Types
  // ==========================================================================
  describe("writeDbTypesFile with multiple types", () => {
    it("generates types with multiple types", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            name: { type: "string", required: true },
          },
        },
        Order: {
          fields: {
            total: { type: "float", required: true },
          },
        },
        Product: {
          fields: {
            sku: { type: "string", required: true },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const filePath = await writeDbTypesFile(snapshot, testDir, 1);
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("User: {");
      expect(content).toContain("Order: {");
      expect(content).toContain("Product: {");
    });
  });

  // ==========================================================================
  // writeDbTypesFile - Breaking Changes
  // ==========================================================================
  describe("writeDbTypesFile with breaking changes (diff)", () => {
    it("generates ColumnType for optional to required change", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            name: { type: "string", required: true },
            // This field was optional and is now required
            email: { type: "string", required: true },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const diff = createMockDiff(
        [
          {
            kind: "field_modified",
            typeName: "User",
            fieldName: "email",
            before: { type: "string", required: false },
            after: { type: "string", required: true },
          },
        ],
        { hasBreakingChanges: true, requiresMigrationScript: true },
      );

      const filePath = await writeDbTypesFile(snapshot, testDir, 1, diff);
      const content = fs.readFileSync(filePath, "utf-8");

      // Should generate ColumnType for optional->required field
      // SELECT returns T | null (existing data might be null)
      // INSERT/UPDATE requires T (must provide a value)
      expect(content).toContain("email: ColumnType<string | null, string, string>;");
    });

    it("generates ColumnType for added required fields", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            name: { type: "string", required: true },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const diff = createMockDiff(
        [
          {
            kind: "field_added",
            typeName: "User",
            fieldName: "role",
            after: { type: "string", required: true },
          },
        ],
        { hasBreakingChanges: true, requiresMigrationScript: true },
      );

      const filePath = await writeDbTypesFile(snapshot, testDir, 1, diff);
      const content = fs.readFileSync(filePath, "utf-8");

      // Added required field should be treated like optional->required
      expect(content).toContain("role: ColumnType<string | null, string, string>;");
    });

    it("generates ColumnType for enum value changes", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            status: {
              type: "enum",
              required: true,
              allowedValues: ["ACTIVE", "INACTIVE"],
            },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const diff = createMockDiff(
        [
          {
            kind: "field_modified",
            typeName: "User",
            fieldName: "status",
            before: {
              type: "enum",
              required: true,
              allowedValues: ["ACTIVE", "INACTIVE", "PENDING"],
            },
            after: {
              type: "enum",
              required: true,
              allowedValues: ["ACTIVE", "INACTIVE"],
            },
          },
        ],
        { hasBreakingChanges: true, requiresMigrationScript: true },
      );

      const filePath = await writeDbTypesFile(snapshot, testDir, 1, diff);
      const content = fs.readFileSync(filePath, "utf-8");

      // Should generate ColumnType with all values for SELECT, only after values for INSERT/UPDATE
      expect(content).toContain("ColumnType<");
      expect(content).toContain('"ACTIVE" | "INACTIVE" | "PENDING"'); // SELECT type (all values)
      expect(content).toContain('"ACTIVE" | "INACTIVE"'); // INSERT/UPDATE type (only after values)
    });

    it("handles enum value changes with nullable fields", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            status: {
              type: "enum",
              required: false,
              allowedValues: ["ACTIVE", "INACTIVE"],
            },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const diff = createMockDiff(
        [
          {
            kind: "field_modified",
            typeName: "User",
            fieldName: "status",
            before: {
              type: "enum",
              required: false,
              allowedValues: ["ACTIVE", "INACTIVE", "PENDING"],
            },
            after: {
              type: "enum",
              required: false,
              allowedValues: ["ACTIVE", "INACTIVE"],
            },
          },
        ],
        { hasBreakingChanges: true, requiresMigrationScript: true },
      );

      const filePath = await writeDbTypesFile(snapshot, testDir, 1, diff);
      const content = fs.readFileSync(filePath, "utf-8");

      // Should include null in all parts
      expect(content).toContain("| null");
    });

    it("handles enum value changes with array fields", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            roles: {
              type: "enum",
              required: true,
              array: true,
              allowedValues: ["ADMIN", "USER"],
            },
          },
        },
      });
      createMigrationDir(testDir, 1);

      const diff = createMockDiff(
        [
          {
            kind: "field_modified",
            typeName: "User",
            fieldName: "roles",
            before: {
              type: "enum",
              required: true,
              array: true,
              allowedValues: ["ADMIN", "USER", "GUEST"],
            },
            after: {
              type: "enum",
              required: true,
              array: true,
              allowedValues: ["ADMIN", "USER"],
            },
          },
        ],
        { hasBreakingChanges: true, requiresMigrationScript: true },
      );

      const filePath = await writeDbTypesFile(snapshot, testDir, 1, diff);
      const content = fs.readFileSync(filePath, "utf-8");

      // Should generate array type with ColumnType
      expect(content).toContain("ColumnType<");
      expect(content).toContain("[]");
    });
  });

  // ==========================================================================
  // writeDbTypesFile - File Location
  // ==========================================================================
  describe("writeDbTypesFile file location", () => {
    it("writes file to correct location", async () => {
      const snapshot = createMockSnapshot({
        User: {
          fields: {
            name: { type: "string", required: true },
          },
        },
      });
      const migrationNumber = 5;
      createMigrationDir(testDir, migrationNumber);

      const filePath = await writeDbTypesFile(snapshot, testDir, migrationNumber);

      const expectedPath = path.join(testDir, formatMigrationNumber(migrationNumber), "db.ts");
      expect(filePath).toBe(expectedPath);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});
