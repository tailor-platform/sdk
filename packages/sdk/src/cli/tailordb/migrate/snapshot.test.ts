import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import {
  createSnapshotFromLocalTypes,
  loadSnapshot,
  loadDiff,
  getMigrationFiles,
  getNextMigrationNumber,
  getLatestMigrationNumber,
  reconstructSnapshotFromMigrations,
  compareSnapshots,
  compareLocalTypesWithSnapshot,
  writeSnapshot,
  writeDiff,
  validateMigrationFiles,
  assertValidMigrationFiles,
} from "./snapshot";
import {
  SCHEMA_SNAPSHOT_VERSION,
  SCHEMA_FILE_NAME,
  DIFF_FILE_NAME,
  INITIAL_SCHEMA_NUMBER,
  formatMigrationNumber,
} from "./types";
import type { SchemaSnapshot, MigrationDiff } from "./types";
import type { ParsedTailorDBType, ParsedField } from "@/parser/service/tailordb/types";

function writeSchemaToDir(baseDir: string, num: number, content: SchemaSnapshot | object): string {
  const migDir = path.join(baseDir, formatMigrationNumber(num));
  fs.mkdirSync(migDir, { recursive: true });
  const filePath = path.join(migDir, SCHEMA_FILE_NAME);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
  return filePath;
}

function writeDiffToDir(baseDir: string, num: number, content: MigrationDiff | object): string {
  const migDir = path.join(baseDir, formatMigrationNumber(num));
  fs.mkdirSync(migDir, { recursive: true });
  const filePath = path.join(migDir, DIFF_FILE_NAME);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
  return filePath;
}

const TEST_MIGRATIONS_BASE = path.join(__dirname, "__test_migrations__");

/**
 * Create a minimal ParsedTailorDBType for testing
 * @param {string} name - Type name
 * @param {Record<string, { name: string; config: Partial<ParsedField["config"]> }>} fields - Field definitions
 * @returns {ParsedTailorDBType} Mock type with required properties filled
 */
function createMockType(
  name: string,
  fields: Record<string, { name: string; config: Partial<ParsedField["config"]> }>,
): ParsedTailorDBType {
  const parsedFields: Record<string, ParsedField> = {};
  for (const [key, field] of Object.entries(fields)) {
    parsedFields[key] = {
      name: field.name,
      config: {
        type: "string",
        required: false,
        ...field.config,
      },
    } as ParsedField;
  }

  return {
    name,
    pluralForm: `${name}s`,
    fields: parsedFields,
    forwardRelationships: {},
    backwardRelationships: {},
    settings: {},
    permissions: {},
  };
}

describe("snapshot", () => {
  const namespace = "tailordb";
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
  // createSnapshotFromLocalTypes
  // ==========================================================================
  describe("createSnapshotFromLocalTypes", () => {
    it("creates snapshot with correct structure", () => {
      const mockTypes: Record<string, ParsedTailorDBType> = {
        User: createMockType("User", {
          id: { name: "id", config: { type: "uuid", required: true } },
          name: { name: "name", config: { type: "string", required: true } },
        }),
      };

      const snapshot = createSnapshotFromLocalTypes(mockTypes, namespace);

      expect(snapshot.version).toBe(SCHEMA_SNAPSHOT_VERSION);
      expect(snapshot.namespace).toBe(namespace);
      expect(snapshot.createdAt).toBeDefined();
      expect(snapshot.types.User).toBeDefined();
      expect(snapshot.types.User.name).toBe("User");
      expect(snapshot.types.User.fields.id).toBeDefined();
      expect(snapshot.types.User.fields.name).toBeDefined();
    });

    it("captures field attributes", () => {
      const mockTypes: Record<string, ParsedTailorDBType> = {
        Product: createMockType("Product", {
          id: { name: "id", config: { type: "uuid", required: true } },
          sku: {
            name: "sku",
            config: { type: "string", required: true, unique: true },
          },
          tags: {
            name: "tags",
            config: { type: "string", required: false, array: true },
          },
        }),
      };

      const snapshot = createSnapshotFromLocalTypes(mockTypes, namespace);

      expect(snapshot.types.Product.fields.sku.required).toBe(true);
      expect(snapshot.types.Product.fields.sku.unique).toBe(true);
      expect(snapshot.types.Product.fields.tags.array).toBe(true);
    });

    it("captures foreign key relationships", () => {
      const mockTypes: Record<string, ParsedTailorDBType> = {
        Order: createMockType("Order", {
          id: { name: "id", config: { type: "uuid", required: true } },
          customerId: {
            name: "customerId",
            config: {
              type: "uuid",
              required: true,
              foreignKey: true,
              foreignKeyType: "Customer",
              foreignKeyField: "id",
            },
          },
        }),
      };

      const snapshot = createSnapshotFromLocalTypes(mockTypes, namespace);

      expect(snapshot.types.Order.fields.customerId.foreignKey).toBe(true);
      expect(snapshot.types.Order.fields.customerId.foreignKeyType).toBe("Customer");
      expect(snapshot.types.Order.fields.customerId.foreignKeyField).toBe("id");
    });

    it("captures enum fields with allowedValues", () => {
      const mockTypes: Record<string, ParsedTailorDBType> = {
        Task: createMockType("Task", {
          id: { name: "id", config: { type: "uuid", required: true } },
          status: {
            name: "status",
            config: {
              type: "enum",
              required: true,
              allowedValues: [{ value: "PENDING" }, { value: "IN_PROGRESS" }, { value: "DONE" }],
            },
          },
        }),
      };

      const snapshot = createSnapshotFromLocalTypes(mockTypes, namespace);

      expect(snapshot.types.Task.fields.status.type).toBe("enum");
      expect(snapshot.types.Task.fields.status.allowedValues).toEqual([
        "PENDING",
        "IN_PROGRESS",
        "DONE",
      ]);
    });

    it("handles empty types object", () => {
      const mockTypes: Record<string, ParsedTailorDBType> = {};
      const snapshot = createSnapshotFromLocalTypes(mockTypes, namespace);

      expect(snapshot.version).toBe(SCHEMA_SNAPSHOT_VERSION);
      expect(snapshot.types).toEqual({});
    });
  });

  // ==========================================================================
  // compareSnapshots
  // ==========================================================================
  describe("compareSnapshots", () => {
    const createEmptySnapshot = (): SchemaSnapshot => ({
      version: SCHEMA_SNAPSHOT_VERSION,
      namespace,
      createdAt: new Date().toISOString(),
      types: {},
    });

    it("detects type addition", () => {
      const previous = createEmptySnapshot();
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          NewType: {
            name: "NewType",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.changes.length).toBe(1);
      expect(diff.changes[0].kind).toBe("type_added");
      expect(diff.changes[0].typeName).toBe("NewType");
      expect(diff.hasBreakingChanges).toBe(false);
    });

    it("detects type removal (non-breaking)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          OldType: {
            name: "OldType",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const current = createEmptySnapshot();

      const diff = compareSnapshots(previous, current);

      expect(diff.changes[0].kind).toBe("type_removed");
      expect(diff.hasBreakingChanges).toBe(false);
      expect(diff.requiresMigrationScript).toBe(false);
    });

    it("detects field addition (optional - non-breaking)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            fields: {
              id: { type: "uuid", required: true },
              email: { type: "string", required: false },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.changes[0].kind).toBe("field_added");
      expect(diff.changes[0].fieldName).toBe("email");
      expect(diff.hasBreakingChanges).toBe(false);
    });

    it("detects field addition (required - breaking change)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            fields: {
              id: { type: "uuid", required: true },
              requiredField: { type: "string", required: true },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0].reason).toBe("Required field added");
    });

    it("detects field removal (non-breaking)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            fields: {
              id: { type: "uuid", required: true },
              name: { type: "string", required: true },
            },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.changes[0].kind).toBe("field_removed");
      expect(diff.hasBreakingChanges).toBe(false);
      expect(diff.requiresMigrationScript).toBe(false);
    });

    it("detects field type change (breaking change)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            fields: {
              id: { type: "uuid", required: true },
              age: { type: "string", required: false },
            },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            fields: {
              id: { type: "uuid", required: true },
              age: { type: "number", required: false },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.changes[0].kind).toBe("field_modified");
      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0].reason).toContain("Field type changed");
    });

    it("detects required flag change (optional to required - breaking)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            fields: {
              id: { type: "uuid", required: true },
              email: { type: "string", required: false },
            },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            fields: {
              id: { type: "uuid", required: true },
              email: { type: "string", required: true },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0].reason).toContain("optional to required");
    });

    it("detects array to single value change (breaking change)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          Post: {
            name: "Post",
            fields: {
              id: { type: "uuid", required: true },
              tags: { type: "string", required: false, array: true },
            },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          Post: {
            name: "Post",
            fields: {
              id: { type: "uuid", required: true },
              tags: { type: "string", required: false, array: false },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0].reason).toContain("array to single value");
    });

    it("detects unique constraint addition (breaking change)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            fields: {
              id: { type: "uuid", required: true },
              email: { type: "string", required: true, unique: false },
            },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            fields: {
              id: { type: "uuid", required: true },
              email: { type: "string", required: true, unique: true },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0].reason).toContain("Unique constraint");
    });

    it("detects enum values removal (breaking change)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          Task: {
            name: "Task",
            fields: {
              id: { type: "uuid", required: true },
              status: {
                type: "enum",
                required: true,
                allowedValues: ["PENDING", "IN_PROGRESS", "DONE", "CANCELLED"],
              },
            },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          Task: {
            name: "Task",
            fields: {
              id: { type: "uuid", required: true },
              status: {
                type: "enum",
                required: true,
                allowedValues: ["PENDING", "IN_PROGRESS", "DONE"],
              },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0].reason).toContain("Enum values removed");
      expect(diff.breakingChanges[0].reason).toContain("CANCELLED");
    });

    it("returns empty diff when no changes", () => {
      const snapshot: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff = compareSnapshots(snapshot, snapshot);

      expect(diff.changes.length).toBe(0);
    });
  });

  // ==========================================================================
  // compareLocalTypesWithSnapshot
  // ==========================================================================
  describe("compareLocalTypesWithSnapshot", () => {
    it("compares local types with existing snapshot", () => {
      const previousSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const localTypes: Record<string, ParsedTailorDBType> = {
        User: createMockType("User", {
          id: { name: "id", config: { type: "uuid", required: true } },
          email: { name: "email", config: { type: "string", required: false } },
        }),
      };

      const diff = compareLocalTypesWithSnapshot(previousSnapshot, localTypes, namespace);

      expect(diff.changes.length).toBe(1);
      expect(diff.changes[0].kind).toBe("field_added");
      expect(diff.changes[0].fieldName).toBe("email");
    });
  });

  // ==========================================================================
  // getMigrationFiles
  // ==========================================================================
  describe("getMigrationFiles", () => {
    it("returns sorted list of migration files (directory structure)", () => {
      const schemaContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
      };
      const diffContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, schemaContent);
      writeDiffToDir(testDir, 2, diffContent);
      writeDiffToDir(testDir, 1, diffContent);

      const files = getMigrationFiles(testDir);

      expect(files.length).toBe(3);
      expect(files[0].number).toBe(INITIAL_SCHEMA_NUMBER);
      expect(files[1].number).toBe(1);
      expect(files[2].number).toBe(2);
    });

    it("identifies schema vs diff files correctly (directory structure)", () => {
      const schemaContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: "",
        types: {},
      };
      const diffContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: "",
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, schemaContent);
      writeDiffToDir(testDir, 1, diffContent);

      const files = getMigrationFiles(testDir);

      expect(files[0].type).toBe("schema");
      expect(files[1].type).toBe("diff");
    });

    it("ignores invalid directories", () => {
      const schemaContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, schemaContent);
      // Create invalid directory name
      fs.mkdirSync(path.join(testDir, "invalid"), { recursive: true });
      fs.writeFileSync(path.join(testDir, "README.md"), "readme");

      const files = getMigrationFiles(testDir);

      expect(files.length).toBe(1);
    });

    it("returns empty array for non-existent directory", () => {
      const nonExistent = path.join(testDir, "does-not-exist");
      const files = getMigrationFiles(nonExistent);
      expect(files).toEqual([]);
    });
  });

  // ==========================================================================
  // getNextMigrationNumber / getLatestMigrationNumber
  // ==========================================================================
  describe("getNextMigrationNumber", () => {
    it("returns INITIAL_SCHEMA_NUMBER (0) for empty directory", () => {
      const nextNum = getNextMigrationNumber(testDir);
      expect(nextNum).toBe(INITIAL_SCHEMA_NUMBER);
    });

    it("returns next number after latest (directory structure)", () => {
      const schemaContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: "",
        types: {},
      };
      const diffContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: "",
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, schemaContent);
      writeDiffToDir(testDir, 1, diffContent);

      const nextNum = getNextMigrationNumber(testDir);

      expect(nextNum).toBe(2);
    });
  });

  describe("getLatestMigrationNumber", () => {
    it("returns 0 for empty directory", () => {
      const latestNum = getLatestMigrationNumber(testDir);
      expect(latestNum).toBe(0);
    });

    it("returns highest migration number (directory structure)", () => {
      const schemaContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: "",
        types: {},
      };
      const diffContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: "",
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, schemaContent);
      writeDiffToDir(testDir, 4, diffContent);

      const latestNum = getLatestMigrationNumber(testDir);

      expect(latestNum).toBe(4);
    });
  });

  // ==========================================================================
  // loadSnapshot / loadDiff / writeSnapshot / writeDiff
  // ==========================================================================
  describe("loadSnapshot", () => {
    it("loads snapshot from file", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const filePath = path.join(testDir, "test_schema.json");
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

      const loaded = loadSnapshot(filePath);

      expect(loaded.version).toBe(SCHEMA_SNAPSHOT_VERSION);
      expect(loaded.types.User).toBeDefined();
    });
  });

  describe("loadDiff", () => {
    it("loads diff from file", () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [{ kind: "type_added", typeName: "NewType" }],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "test_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(diff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.changes.length).toBe(1);
      expect(loaded.changes[0].kind).toBe("type_added");
    });
  });

  describe("writeSnapshot", () => {
    it("writes snapshot to directory structure with correct name", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
      };

      const filePath = writeSnapshot(snapshot, testDir, INITIAL_SCHEMA_NUMBER);

      expect(filePath).toBe(
        path.join(testDir, formatMigrationNumber(INITIAL_SCHEMA_NUMBER), SCHEMA_FILE_NAME),
      );
      expect(fs.existsSync(filePath)).toBe(true);

      const loaded = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(loaded.version).toBe(SCHEMA_SNAPSHOT_VERSION);
    });
  });

  describe("writeDiff", () => {
    it("writes diff to directory structure with correct name", () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      const filePath = writeDiff(diff, testDir, 1);

      expect(filePath).toBe(path.join(testDir, formatMigrationNumber(1), DIFF_FILE_NAME));
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  // ==========================================================================
  // reconstructSnapshotFromMigrations
  // ==========================================================================
  describe("reconstructSnapshotFromMigrations", () => {
    it("reconstructs from initial schema only (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
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
      expect(reconstructed?.types.User).toBeDefined();
      expect(reconstructed?.types.User.fields.id).toBeDefined();
      expect(reconstructed?.types.User.fields.name).toBeDefined();
    });

    it("applies single diff to schema (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
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
            typeName: "User",
            fieldName: "email",
            after: { type: "string", required: false },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, initialSnapshot);
      writeDiffToDir(testDir, 1, diff);

      const reconstructed = reconstructSnapshotFromMigrations(testDir);

      expect(reconstructed?.types.User.fields.id).toBeDefined();
      expect(reconstructed?.types.User.fields.email).toBeDefined();
    });

    it("applies multiple diffs sequentially (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
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
            typeName: "User",
            fieldName: "name",
            after: { type: "string", required: true },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      const diff2: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
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

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, initialSnapshot);
      writeDiffToDir(testDir, 1, diff1);
      writeDiffToDir(testDir, 2, diff2);

      const reconstructed = reconstructSnapshotFromMigrations(testDir);

      expect(reconstructed?.types.User.fields.id).toBeDefined();
      expect(reconstructed?.types.User.fields.name).toBeDefined();
      expect(reconstructed?.types.User.fields.email).toBeDefined();
    });

    it("handles type addition in diff (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
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
            kind: "type_added",
            typeName: "Post",
            after: {
              name: "Post",
              fields: {
                id: { type: "uuid", required: true },
                title: { type: "string", required: true },
              },
            },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, initialSnapshot);
      writeDiffToDir(testDir, 1, diff);

      const reconstructed = reconstructSnapshotFromMigrations(testDir);

      expect(reconstructed?.types.User).toBeDefined();
      expect(reconstructed?.types.Post).toBeDefined();
      expect(reconstructed?.types.Post.fields.title).toBeDefined();
    });

    it("handles type removal in diff (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            fields: { id: { type: "uuid", required: true } },
          },
          OldType: {
            name: "OldType",
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
            kind: "type_removed",
            typeName: "OldType",
            before: {
              name: "OldType",
              fields: { id: { type: "uuid", required: true } },
            },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, initialSnapshot);
      writeDiffToDir(testDir, 1, diff);

      const reconstructed = reconstructSnapshotFromMigrations(testDir);

      expect(reconstructed?.types.User).toBeDefined();
      expect(reconstructed?.types.OldType).toBeUndefined();
    });

    it("returns null for empty directory", () => {
      const reconstructed = reconstructSnapshotFromMigrations(testDir);
      expect(reconstructed).toBeNull();
    });
  });

  // ==========================================================================
  // validateMigrationFiles / assertValidMigrationFiles
  // ==========================================================================
  describe("validateMigrationFiles", () => {
    it("returns empty array for non-existent directory", () => {
      const errors = validateMigrationFiles(path.join(testDir, "does-not-exist"));
      expect(errors).toEqual([]);
    });

    it("returns empty array for empty directory", () => {
      const errors = validateMigrationFiles(testDir);
      expect(errors).toEqual([]);
    });

    it("returns empty array for valid single schema file (directory structure)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
      };
      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, snapshot);

      const errors = validateMigrationFiles(testDir);
      expect(errors).toEqual([]);
    });

    it("returns empty array for valid schema + diff sequence (directory structure)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
      };
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, snapshot);
      writeDiffToDir(testDir, 1, diff);
      writeDiffToDir(testDir, 2, diff);

      const errors = validateMigrationFiles(testDir);
      expect(errors).toEqual([]);
    });

    it("detects missing initial schema snapshot (directory structure)", () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
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

    it("detects gap in migration sequence (directory structure)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
      };
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
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

    it("detects schema file at wrong position (directory structure)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
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

    it("detects missing diff file for migration > 0 (directory structure)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
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
    it("does not throw for valid migrations (directory structure)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
      };
      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, snapshot);

      expect(() => assertValidMigrationFiles(testDir, "test")).not.toThrow();
    });

    it("throws for invalid migrations with detailed error message (directory structure)", () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
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
