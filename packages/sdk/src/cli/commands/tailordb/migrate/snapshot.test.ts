import * as fs from "node:fs";
import {
  TailorDBGQLPermission_Action,
  TailorDBGQLPermission_Permit,
  TailorDBType_PermitAction,
  TailorDBType_Permission_Permit,
  type TailorDBType as ProtoTailorDBType,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import * as path from "pathe";
import { describe, expect, expectTypeOf, test, beforeEach, afterAll, vi } from "vitest";
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
  compareRemoteWithSnapshot,
  createSnapshotFromRemoteTypes,
  formatSchemaDrifts,
  normalizeSchemaSnapshot,
  writeSnapshot,
  writeDiff,
  validateMigrationFiles,
  assertValidMigrationFiles,
  SCHEMA_SNAPSHOT_VERSION,
  SCHEMA_FILE_NAME,
  DIFF_FILE_NAME,
  INITIAL_SCHEMA_NUMBER,
  formatMigrationNumber,
  type NormalizedSchemaSnapshot,
  type RemoteGqlPermission,
  type SchemaSnapshot,
} from "./snapshot";
import type { ParsedField, TailorDBType } from "#/parser/service/tailordb/types";
import type { MigrationDiff, RelationshipAddedChange } from "./diff-calculator";

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
 * Create a minimal TailorDBType for testing
 * @param {string} name - Type name
 * @param {Record<string, { name: string; config: Partial<ParsedField["config"]> }>} fields - Field definitions
 * @returns {TailorDBType} Mock type with required properties filled
 */
function createMockType(
  name: string,
  fields: Record<string, { name: string; config: Partial<ParsedField["config"]> }>,
): TailorDBType {
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
    test("creates snapshot with correct structure", () => {
      const mockTypes: Record<string, TailorDBType> = {
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
      expect(snapshot.types.User!.name).toBe("User");
      expect(snapshot.types.User!.fields.id).toBeDefined();
      expect(snapshot.types.User!.fields.name).toBeDefined();
    });

    test("captures field attributes", () => {
      const mockTypes: Record<string, TailorDBType> = {
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

      expect(snapshot.types.Product!.fields.sku!.required).toBe(true);
      expect(snapshot.types.Product!.fields.sku!.unique).toBe(true);
      expect(snapshot.types.Product!.fields.tags!.array).toBe(true);
    });

    test("captures foreign key relationships", () => {
      const mockTypes: Record<string, TailorDBType> = {
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

      expect(snapshot.types.Order!.fields.customerId!.foreignKey).toBe(true);
      expect(snapshot.types.Order!.fields.customerId!.foreignKeyType).toBe("Customer");
      expect(snapshot.types.Order!.fields.customerId!.foreignKeyField).toBe("id");
    });

    test("captures enum fields with allowedValues", () => {
      const mockTypes: Record<string, TailorDBType> = {
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

      expect(snapshot.types.Task!.fields.status!.type).toBe("enum");
      expect(snapshot.types.Task!.fields.status!.allowedValues).toEqual([
        { value: "PENDING" },
        { value: "IN_PROGRESS" },
        { value: "DONE" },
      ]);
    });

    test("handles empty types object", () => {
      const mockTypes: Record<string, TailorDBType> = {};
      const snapshot = createSnapshotFromLocalTypes(mockTypes, namespace);

      expect(snapshot.version).toBe(SCHEMA_SNAPSHOT_VERSION);
      expect(snapshot.types).toEqual({});
    });
  });

  describe("normalizeSchemaSnapshot", () => {
    test("normalizes legacy type and nested field defaults in one pass", () => {
      const snapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          Product: {
            name: "Product",
            fields: {
              price: { type: "decimal", required: true },
              metadata: {
                type: "object",
                required: false,
                fields: {
                  discount: { type: "decimal", required: false },
                },
              },
            },
          },
        },
      } as unknown as SchemaSnapshot;

      const normalized = normalizeSchemaSnapshot(snapshot);

      expect(normalized).not.toBe(snapshot);
      expectTypeOf(normalized).toEqualTypeOf<NormalizedSchemaSnapshot>();
      expectTypeOf<NormalizedSchemaSnapshot>().toExtend<SchemaSnapshot>();
      expectTypeOf<SchemaSnapshot>().not.toExtend<NormalizedSchemaSnapshot>();
      expect(normalized.types.Product?.pluralForm).toBe("Products");
      expect(normalized.types.Product?.fields.price?.scale).toBe(6);
      expect(normalized.types.Product?.fields.metadata?.fields?.discount?.scale).toBe(6);

      // Original snapshot must remain unmutated (the footgun this behavior fixes)
      expect(snapshot.types.Product?.pluralForm).toBeUndefined();
      expect(snapshot.types.Product?.fields.price?.scale).toBeUndefined();
      expect(snapshot.types.Product?.fields.metadata?.fields?.discount?.scale).toBeUndefined();
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

    test("detects type addition", () => {
      const previous = createEmptySnapshot();
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          NewType: {
            name: "NewType",
            pluralForm: "NewTypes",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.changes.length).toBe(1);
      expect(diff.changes[0]!.kind).toBe("type_added");
      expect(diff.changes[0]!.typeName).toBe("NewType");
      expect(diff.hasBreakingChanges).toBe(false);
    });

    test("detects type removal (non-breaking)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          OldType: {
            name: "OldType",
            pluralForm: "OldTypes",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const current = createEmptySnapshot();

      const diff = compareSnapshots(previous, current);

      expect(diff.changes[0]!.kind).toBe("type_removed");
      expect(diff.hasBreakingChanges).toBe(false);
      expect(diff.requiresMigrationScript).toBe(false);
      expect(diff.hasWarnings).toBe(true);
      expect(diff.warnings).toEqual([
        {
          typeName: "OldType",
          reason:
            "Type removed (all records of this type will be dropped in the post-migration phase)",
        },
      ]);
    });

    test("detects field addition (optional - non-breaking)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              email: { type: "string", required: false },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.changes[0]).toMatchObject({ kind: "field_added", fieldName: "email" });
      expect(diff.hasBreakingChanges).toBe(false);
    });

    test("detects field addition (required - breaking change)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              requiredField: { type: "string", required: true },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0]!.reason).toBe("Required field added");
    });

    test("detects field removal (non-breaking)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
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
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.changes[0]!.kind).toBe("field_removed");
      expect(diff.hasBreakingChanges).toBe(false);
      expect(diff.requiresMigrationScript).toBe(false);
      expect(diff.hasWarnings).toBe(true);
      expect(diff.warnings).toEqual([
        {
          typeName: "User",
          fieldName: "name",
          reason: "Field removed (existing data will be dropped in the post-migration phase)",
        },
      ]);
    });

    test("detects field type change (breaking change)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
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
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              age: { type: "number", required: false },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.changes[0]!.kind).toBe("field_modified");
      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0]!.reason).toContain("Field type changed");
    });

    test("normalizes decimal scale at compare entry so missing scale matches platform default", () => {
      // Reproduces the production scenario where one snapshot was loaded from
      // an older file that omitted `scale` and the other was produced by
      // `createSnapshotType` (which materializes the platform default of 6).
      // compareSnapshots normalizes both inputs at the entry, so the diff must
      // come out empty even though the literal shapes differ.
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          Order: {
            name: "Order",
            pluralForm: "Orders",
            fields: {
              id: { type: "uuid", required: true },
              amount: { type: "decimal", required: true },
            },
          },
        },
      };
      const current = createSnapshotFromLocalTypes(
        {
          Order: createMockType("Order", {
            id: { name: "id", config: { type: "uuid", required: true } },
            amount: { name: "amount", config: { type: "decimal", required: true } },
          }),
        },
        namespace,
      );

      const diff = compareSnapshots(previous, current);

      expect(diff.changes).toEqual([]);
      expect(diff.hasBreakingChanges).toBe(false);
    });

    test("detects required flag change (optional to required - breaking)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
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
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              email: { type: "string", required: true },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0]!.reason).toContain("optional to required");
    });

    test("detects array to single value change (breaking change)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          Post: {
            name: "Post",
            pluralForm: "Posts",
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
            pluralForm: "Posts",
            fields: {
              id: { type: "uuid", required: true },
              tags: { type: "string", required: false, array: false },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0]!.reason).toContain("array to single value");
    });

    test("detects unique constraint addition (breaking change)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
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
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              email: { type: "string", required: true, unique: true },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0]!.reason).toContain("Unique constraint");
    });

    test("detects enum values removal (breaking change)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          Task: {
            name: "Task",
            pluralForm: "Tasks",
            fields: {
              id: { type: "uuid", required: true },
              status: {
                type: "enum",
                required: true,
                allowedValues: [
                  { value: "PENDING" },
                  { value: "IN_PROGRESS" },
                  { value: "DONE" },
                  { value: "CANCELLED" },
                ],
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
            pluralForm: "Tasks",
            fields: {
              id: { type: "uuid", required: true },
              status: {
                type: "enum",
                required: true,
                allowedValues: [{ value: "PENDING" }, { value: "IN_PROGRESS" }, { value: "DONE" }],
              },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0]!.reason).toContain("Enum values removed");
      expect(diff.breakingChanges[0]!.reason).toContain("CANCELLED");
    });

    test("does not detect change when enum values are reordered", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          Task: {
            name: "Task",
            pluralForm: "Tasks",
            fields: {
              id: { type: "uuid", required: true },
              status: {
                type: "enum",
                required: true,
                allowedValues: [{ value: "PENDING" }, { value: "IN_PROGRESS" }, { value: "DONE" }],
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
            pluralForm: "Tasks",
            fields: {
              id: { type: "uuid", required: true },
              status: {
                type: "enum",
                required: true,
                // Same values, different order
                allowedValues: [{ value: "DONE" }, { value: "PENDING" }, { value: "IN_PROGRESS" }],
              },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.changes.length).toBe(0);
      expect(diff.hasBreakingChanges).toBe(false);
    });

    test("detects change when enum values are added (regardless of order)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          Task: {
            name: "Task",
            pluralForm: "Tasks",
            fields: {
              id: { type: "uuid", required: true },
              status: {
                type: "enum",
                required: true,
                allowedValues: [{ value: "PENDING" }, { value: "DONE" }],
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
            pluralForm: "Tasks",
            fields: {
              id: { type: "uuid", required: true },
              status: {
                type: "enum",
                required: true,
                // Added IN_PROGRESS, reordered
                allowedValues: [{ value: "DONE" }, { value: "IN_PROGRESS" }, { value: "PENDING" }],
              },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.changes.length).toBe(1);
      expect(diff.changes[0]!.kind).toBe("field_modified");
      expect(diff.hasBreakingChanges).toBe(false);
    });

    test("returns empty diff when no changes", () => {
      const snapshot: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff = compareSnapshots(snapshot, snapshot);

      expect(diff.changes.length).toBe(0);
    });

    test("detects type settings changes", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            settings: { aggregation: true, publishEvents: true },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            settings: { bulkUpsert: true, gqlOperations: { create: false } },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.changes).toEqual([
        expect.objectContaining({
          kind: "type_settings_modified",
          typeName: "User",
          reason: expect.stringContaining("settings changed"),
        }),
      ]);
    });

    test("detects explicit GQL operation enable overrides", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            settings: { gqlOperations: { create: true } },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.changes).toEqual([
        expect.objectContaining({
          kind: "type_settings_modified",
          typeName: "User",
          reason: expect.stringContaining("settings changed"),
        }),
      ]);
    });

    test("detects explicit empty GQL operation overrides", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            settings: { gqlOperations: {} },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.changes).toEqual([
        expect.objectContaining({
          kind: "type_settings_modified",
          typeName: "User",
          reason: expect.stringContaining("settings changed"),
        }),
      ]);
    });

    test("includes relationshipType in relationship_added changes", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
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

      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            backwardRelationships: {
              posts: {
                targetType: "Post",
                targetField: "authorId",
                sourceField: "id",
                isArray: true,
                description: "",
              },
            },
          },
          Post: {
            name: "Post",
            pluralForm: "Posts",
            fields: {
              id: { type: "uuid", required: true },
              authorId: { type: "uuid", required: true },
            },
            forwardRelationships: {
              author: {
                targetType: "User",
                targetField: "id",
                sourceField: "authorId",
                isArray: false,
                description: "",
              },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      const forwardChange = diff.changes.find(
        (c): c is RelationshipAddedChange =>
          c.kind === "relationship_added" && c.relationshipName === "author",
      );
      const backwardChange = diff.changes.find(
        (c): c is RelationshipAddedChange =>
          c.kind === "relationship_added" && c.relationshipName === "posts",
      );

      expect(forwardChange?.relationshipType).toBe("forward");
      expect(backwardChange?.relationshipType).toBe("backward");
    });

    test("detects relationship description changes", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            backwardRelationships: {
              posts: {
                targetType: "Post",
                targetField: "authorId",
                sourceField: "id",
                isArray: true,
                description: "Posts by user",
              },
            },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            backwardRelationships: {
              posts: {
                targetType: "Post",
                targetField: "authorId",
                sourceField: "id",
                isArray: true,
                description: "Published posts by user",
              },
            },
          },
        },
      };

      const diff = compareSnapshots(previous, current);

      expect(diff.changes).toEqual([
        expect.objectContaining({
          kind: "relationship_modified",
          typeName: "User",
          relationshipName: "posts",
          relationshipType: "backward",
          reason: expect.stringContaining("description changed"),
        }),
      ]);
    });
  });

  // ==========================================================================
  // compareLocalTypesWithSnapshot
  // ==========================================================================
  describe("compareLocalTypesWithSnapshot", () => {
    test("compares local types with existing snapshot", () => {
      const previousSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const localTypes: Record<string, TailorDBType> = {
        User: createMockType("User", {
          id: { name: "id", config: { type: "uuid", required: true } },
          email: { name: "email", config: { type: "string", required: false } },
        }),
      };

      const snapshotTypes = createSnapshotFromLocalTypes(localTypes, namespace).types;
      const diff = compareLocalTypesWithSnapshot(previousSnapshot, snapshotTypes, namespace);

      expect(diff.changes.length).toBe(1);
      expect(diff.changes[0]).toMatchObject({ kind: "field_added", fieldName: "email" });
    });
  });

  // ==========================================================================
  // getMigrationFiles
  // ==========================================================================
  describe("getMigrationFiles", () => {
    test("returns sorted list of migration files (directory structure)", () => {
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
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, schemaContent);
      writeDiffToDir(testDir, 2, diffContent);
      writeDiffToDir(testDir, 1, diffContent);

      const files = getMigrationFiles(testDir);

      expect(files.length).toBe(3);
      expect(files[0]!.number).toBe(INITIAL_SCHEMA_NUMBER);
      expect(files[1]!.number).toBe(1);
      expect(files[2]!.number).toBe(2);
    });

    test("identifies schema vs diff files correctly (directory structure)", () => {
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
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, schemaContent);
      writeDiffToDir(testDir, 1, diffContent);

      const files = getMigrationFiles(testDir);

      expect(files[0]!.type).toBe("schema");
      expect(files[1]!.type).toBe("diff");
    });

    test("ignores invalid directories", () => {
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

    test("returns empty array for non-existent directory", () => {
      const nonExistent = path.join(testDir, "does-not-exist");
      const files = getMigrationFiles(nonExistent);
      expect(files).toEqual([]);
    });
  });

  // ==========================================================================
  // getNextMigrationNumber / getLatestMigrationNumber
  // ==========================================================================
  describe("getNextMigrationNumber", () => {
    test("returns INITIAL_SCHEMA_NUMBER (0) for empty directory", () => {
      const nextNum = getNextMigrationNumber(testDir);
      expect(nextNum).toBe(INITIAL_SCHEMA_NUMBER);
    });

    test("returns next number after latest (directory structure)", () => {
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
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, schemaContent);
      writeDiffToDir(testDir, 1, diffContent);

      const nextNum = getNextMigrationNumber(testDir);

      expect(nextNum).toBe(2);
    });
  });

  describe("getLatestMigrationNumber", () => {
    test("returns 0 for empty directory", () => {
      const latestNum = getLatestMigrationNumber(testDir);
      expect(latestNum).toBe(0);
    });

    test("returns highest migration number (directory structure)", () => {
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
        hasWarnings: false,
        warnings: [],
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
    test("loads snapshot from file", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
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

    test("preserves type names that match Object prototype keys", () => {
      const types = Object.create(null) as SchemaSnapshot["types"];
      types["__proto__"] = {
        name: "__proto__",
        pluralForm: "__proto__",
        fields: { id: { type: "uuid", required: true } },
      };
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types,
      };

      const filePath = path.join(testDir, "proto_schema.json");
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

      const loaded = loadSnapshot(filePath);

      expect(Object.hasOwn(loaded.types, "__proto__")).toBe(true);
      expect(loaded.types["__proto__"]?.fields.id).toBeDefined();
    });
  });

  describe("loadDiff", () => {
    test("loads diff from file", () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "type_added",
            typeName: "NewType",
            after: { name: "NewType", pluralForm: "NewTypes", fields: {} },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "test_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(diff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.changes.length).toBe(1);
      expect(loaded.changes[0]!.kind).toBe("type_added");
    });

    test("backfills warnings fields for legacy diff.json", () => {
      // Legacy diff.json written before warning-tier support shipped. The file
      // has no warnings/hasWarnings keys at all.
      const legacyDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "type_added",
            typeName: "NewType",
            after: { name: "NewType", pluralForm: "NewTypes", fields: {} },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "legacy_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(legacyDiff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.warnings).toEqual([]);
      expect(loaded.hasWarnings).toBe(false);
      expect(loaded.changes.length).toBe(1);
    });

    test("derives hasWarnings from warnings array regardless of stored flag", () => {
      // A hand-edited diff.json could end up with mismatched warnings and
      // hasWarnings; the loader must reconcile to the array.
      const inconsistentDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [
          {
            typeName: "Product",
            fieldName: "legacyCode",
            reason: "Field was removed",
          },
        ],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "inconsistent_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(inconsistentDiff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.warnings.length).toBe(1);
      expect(loaded.hasWarnings).toBe(true);
    });
  });

  describe("loadSnapshot validation", () => {
    test("loads a snapshot with a different format version", () => {
      // example/migrations contain snapshots with version 2; the loader must
      // not pin the version field to the current constant.
      const filePath = path.join(testDir, "v2_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 2,
          namespace,
          createdAt: new Date().toISOString(),
          types: { User: { name: "User", pluralForm: "Users", fields: {} } },
        }),
      );

      expect(loadSnapshot(filePath).version).toBe(2);
    });

    test("rejects an ambiguous permission field-ref operand", () => {
      const filePath = path.join(testDir, "ambiguous_operand_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: new Date().toISOString(),
          types: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: {},
              permissions: {
                record: {
                  create: [],
                  read: [
                    {
                      permit: "allow",
                      conditions: [[{ user: "id", record: "ownerId" }, "eq", "x"]],
                    },
                  ],
                  update: [],
                  delete: [],
                },
              },
            },
          },
        }),
      );

      expect(() => loadSnapshot(filePath)).toThrow(filePath);
    });

    test("rejects a record field-ref in GQL permission conditions", () => {
      const filePath = path.join(testDir, "gql_record_ref_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: new Date().toISOString(),
          types: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: {},
              permissions: {
                gql: [
                  {
                    permit: "allow",
                    actions: ["read"],
                    conditions: [[{ record: "ownerId" }, "eq", "x"]],
                  },
                ],
              },
            },
          },
        }),
      );

      expect(() => loadSnapshot(filePath)).toThrow(filePath);
    });

    test("loads a snapshot with an unknown operator string", () => {
      const filePath = path.join(testDir, "unknown_operator_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: new Date().toISOString(),
          types: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: {},
              permissions: {
                record: {
                  create: [],
                  read: [
                    {
                      permit: "allow",
                      conditions: [["x", "startsWith", "admin"]],
                    },
                  ],
                  update: [],
                  delete: [],
                },
              },
            },
          },
        }),
      );

      expect(() => loadSnapshot(filePath)).not.toThrow();
    });

    test("loads a snapshot with an unknown GQL action", () => {
      const filePath = path.join(testDir, "unknown_gql_action_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: new Date().toISOString(),
          types: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: {},
              permissions: {
                gql: [
                  {
                    permit: "allow",
                    actions: ["futureAction"],
                    conditions: [["x", "eq", "y"]],
                  },
                ],
              },
            },
          },
        }),
      );

      expect(() => loadSnapshot(filePath)).not.toThrow();
    });

    test("loads a field config without required and defaults it to true", () => {
      const filePath = path.join(testDir, "no_required_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: new Date().toISOString(),
          types: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: {
                name: { type: "string" },
              },
            },
          },
        }),
      );

      const loaded = loadSnapshot(filePath);
      expect(loaded.types.User?.fields.name?.required).toBe(true);
    });

    test("loads a partial record permission object (only create and read)", () => {
      const filePath = path.join(testDir, "partial_permission_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: new Date().toISOString(),
          types: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: {},
              permissions: {
                record: {
                  create: [{ permit: "allow", conditions: [] }],
                  read: [{ permit: "allow", conditions: [] }],
                },
              },
            },
          },
        }),
      );

      const loaded = loadSnapshot(filePath);
      expect(loaded.types.User?.permissions?.record?.create).toHaveLength(1);
      expect(loaded.types.User?.permissions?.record?.update).toEqual([]);
      expect(loaded.types.User?.permissions?.record?.delete).toEqual([]);
    });

    test("throws with file path when the file is not valid JSON", () => {
      const filePath = path.join(testDir, "truncated_schema.json");
      fs.writeFileSync(filePath, '{"version": 1, "namespace": "x"');

      expect(() => loadSnapshot(filePath)).toThrow(filePath);
    });

    test("throws with file path when JSON is not an object", () => {
      const filePath = path.join(testDir, "corrupt_schema.json");
      fs.writeFileSync(filePath, JSON.stringify("not an object"));

      expect(() => loadSnapshot(filePath)).toThrow(filePath);
    });

    test("throws with file path and offending field path when a required field has wrong type", () => {
      const filePath = path.join(testDir, "bad_type_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({ version: 1, namespace: 42, createdAt: "t", types: {} }),
      );

      let thrownError: unknown;
      try {
        loadSnapshot(filePath);
      } catch (e) {
        thrownError = e;
      }
      expect(thrownError).toBeInstanceOf(Error);
      const message = (thrownError as Error).message;
      expect(message).toContain(filePath);
      // z.prettifyError includes the field path ("namespace") in the output
      expect(message).toContain("namespace");
    });

    test("loads a legacy snapshot missing newer optional fields", () => {
      // Older snapshots may omit pluralForm and settings on a type.
      const legacySnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          Product: {
            name: "Product",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const filePath = path.join(testDir, "legacy_schema.json");
      fs.writeFileSync(filePath, JSON.stringify(legacySnapshot, null, 2));

      const loaded = loadSnapshot(filePath);
      expect(loaded.types.Product?.name).toBe("Product");
      // pluralForm is backfilled from inflection
      expect(loaded.types.Product?.pluralForm).toBe("Products");
    });

    test("unknown extra keys survive loadSnapshot → writeSnapshot round-trip", () => {
      // A snapshot written by a newer CLI may include unknown fields; they
      // must not be silently dropped on load/save.
      const snapshotWithExtra = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        futureTopLevelField: "keep-me",
        types: {
          Widget: {
            name: "Widget",
            pluralForm: "Widgets",
            futurTypeField: "also-keep",
            fields: {
              id: { type: "uuid", required: true, futureFieldProp: true },
            },
          },
        },
      };
      const loadPath = path.join(testDir, "future_schema.json");
      fs.writeFileSync(loadPath, JSON.stringify(snapshotWithExtra, null, 2));

      const loaded = loadSnapshot(loadPath);
      const savedPath = writeSnapshot(loaded, testDir, 99);
      const saved = JSON.parse(fs.readFileSync(savedPath, "utf-8")) as Record<string, unknown>;

      expect(saved.futureTopLevelField).toBe("keep-me");
      const widget = (saved.types as Record<string, unknown>).Widget as Record<string, unknown>;
      expect(widget.futurTypeField).toBe("also-keep");
      const idField = (widget.fields as Record<string, unknown>).id as Record<string, unknown>;
      expect(idField.futureFieldProp).toBe(true);
    });
  });

  describe("loadDiff validation", () => {
    test("throws with file path when JSON is not an object", () => {
      const filePath = path.join(testDir, "corrupt_diff.json");
      fs.writeFileSync(filePath, JSON.stringify([1, 2, 3]));

      expect(() => loadDiff(filePath)).toThrow(filePath);
    });

    test("throws with file path when a required field has wrong type", () => {
      const filePath = path.join(testDir, "bad_type_diff.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: "t",
          changes: "not-an-array",
          hasBreakingChanges: false,
          breakingChanges: [],
          requiresMigrationScript: false,
        }),
      );

      expect(() => loadDiff(filePath)).toThrow(filePath);
    });
  });

  describe("writeSnapshot", () => {
    test("writes snapshot to directory structure with correct name", () => {
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
    test("writes diff to directory structure with correct name", () => {
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

      const filePath = writeDiff(diff, testDir, 1);

      expect(filePath).toBe(path.join(testDir, formatMigrationNumber(1), DIFF_FILE_NAME));
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  // ==========================================================================
  // reconstructSnapshotFromMigrations
  // ==========================================================================
  describe("reconstructSnapshotFromMigrations", () => {
    test("reconstructs from initial schema only (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
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
      expect(reconstructed?.types.User).toBeDefined();
      expect(reconstructed?.types.User!.fields.id).toBeDefined();
      expect(reconstructed?.types.User!.fields.name).toBeDefined();
    });

    test("applies single diff to schema (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
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
            typeName: "User",
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

      expect(reconstructed?.types.User!.fields.id).toBeDefined();
      expect(reconstructed?.types.User!.fields.email).toBeDefined();
    });

    test("applies added type names that match Object prototype keys", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
      };

      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "type_added",
            typeName: "__proto__",
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

      expect(Object.hasOwn(reconstructed?.types ?? {}, "__proto__")).toBe(true);
      expect(reconstructed?.types["__proto__"]?.fields.id).toBeDefined();
    });

    test("applies multiple diffs sequentially (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
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
            typeName: "User",
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
            typeName: "User",
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

      expect(reconstructed?.types.User!.fields.id).toBeDefined();
      expect(reconstructed?.types.User!.fields.name).toBeDefined();
      expect(reconstructed?.types.User!.fields.email).toBeDefined();
    });

    test("handles type addition in diff (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
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
            kind: "type_added",
            typeName: "Post",
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

      expect(reconstructed?.types.User).toBeDefined();
      expect(reconstructed?.types.Post).toBeDefined();
      expect(reconstructed?.types.Post!.fields.title).toBeDefined();
    });

    test("handles type removal in diff (directory structure)", () => {
      const initialSnapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
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
            kind: "type_removed",
            typeName: "OldType",
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

      expect(reconstructed?.types.User).toBeDefined();
      expect(reconstructed?.types.OldType).toBeUndefined();
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
        types: {
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
            typeName: "Post",
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
            typeName: "User",
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
      expect(reconstructed?.types.Post!.forwardRelationships?.author).toBeDefined();
      expect(reconstructed?.types.Post!.forwardRelationships?.author!.targetType).toBe("User");

      // Backward relationship should be in backwardRelationships (NOT forwardRelationships)
      expect(reconstructed?.types.User!.backwardRelationships?.posts).toBeDefined();
      expect(reconstructed?.types.User!.backwardRelationships?.posts!.targetType).toBe("Post");
      expect(reconstructed?.types.User!.forwardRelationships?.posts).toBeUndefined();
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
        types: {},
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
        types: {},
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
        types: {},
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

    test("detects missing diff file for migration > 0 (directory structure)", () => {
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
    test("does not throw for valid migrations (directory structure)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
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

  // ==========================================================================
  // compareRemoteWithSnapshot
  // ==========================================================================
  describe("compareRemoteWithSnapshot", () => {
    type MockRemoteFieldConfig = {
      type: string;
      required: boolean;
      array?: boolean;
      unique?: boolean;
      foreignKey?: boolean;
      foreignKeyType?: string;
      foreignKeyField?: string;
      index?: boolean;
      allowedValues?: { value: string }[];
      description?: string;
      scale?: number;
      validate?: unknown[];
      hooks?: {
        create?: { expr: string };
        update?: { expr: string };
      };
      serial?: {
        start: number;
        maxValue?: number;
        format?: string;
      };
      fields?: Record<string, MockRemoteFieldConfig>;
    };

    function createMockRemoteFieldConfigs(
      fields: Record<string, MockRemoteFieldConfig>,
    ): Record<string, unknown> {
      const fieldConfigs: Record<string, unknown> = {};
      for (const [fieldName, config] of Object.entries(fields)) {
        fieldConfigs[fieldName] = {
          type: config.type,
          required: config.required,
          array: config.array ?? false,
          index: config.index ?? false,
          unique: config.unique ?? false,
          foreignKey: config.foreignKey ?? false,
          foreignKeyType: config.foreignKeyType,
          foreignKeyField: config.foreignKeyField,
          description: config.description ?? "",
          allowedValues: config.allowedValues ?? [],
          validate: config.validate ?? [],
          hooks: config.hooks,
          serial: config.serial,
          fields: config.fields ? createMockRemoteFieldConfigs(config.fields) : {},
          ...(config.scale !== undefined && { scale: config.scale }),
        };
      }
      return fieldConfigs;
    }

    /**
     * Create a mock ParsedTailorDBType for testing
     * @param {string} name - Type name
     * @param {Record<string, object>} fields - Field configurations
     * @param {Record<string, unknown>} schema - Additional remote schema properties
     * @returns {ProtoTailorDBType} Mock ParsedTailorDBType
     */
    function createMockRemoteType(
      name: string,
      fields: Record<string, MockRemoteFieldConfig>,
      schema: Record<string, unknown> = {},
    ): ProtoTailorDBType {
      return {
        name,
        schema: {
          ...schema,
          fields: createMockRemoteFieldConfigs(fields),
        },
      } as unknown as ProtoTailorDBType;
    }

    function createMockRemoteGqlPermission(
      typeName: string,
      permit: TailorDBGQLPermission_Permit,
      actions: TailorDBGQLPermission_Action[] = [TailorDBGQLPermission_Action.READ],
    ): RemoteGqlPermission {
      return {
        typeName,
        permission: {
          id: "task-gql-permission",
          policies: [
            {
              conditions: [],
              actions,
              permit,
              description: "Can read tasks",
            },
          ],
        },
      } as unknown as RemoteGqlPermission;
    }

    test("reconstructs remote types as normalized schema snapshots", () => {
      const snapshot = createSnapshotFromRemoteTypes(
        [
          createMockRemoteType("Order", {
            id: { type: "uuid", required: true },
            amount: { type: "decimal", required: true },
          }),
        ],
        namespace,
      );

      expect(snapshot.namespace).toBe(namespace);
      expect(snapshot.types.Order?.pluralForm).toBe("Orders");
      expect(snapshot.types.Order?.fields.amount?.scale).toBe(6);
    });

    test("reconstructs remote type-level schema elements", () => {
      const snapshot = createSnapshotFromRemoteTypes(
        [
          createMockRemoteType(
            "User",
            {
              id: { type: "uuid", required: true },
              email: { type: "string", required: true, index: true },
            },
            {
              description: "Application user",
              settings: {
                pluralForm: "users",
                aggregation: true,
                bulkUpsert: true,
                publishRecordEvents: true,
                disableGqlOperations: { create: true, update: false, delete: false, read: false },
              },
              indexes: {
                email_unique: { fieldNames: ["email"], unique: true },
              },
              files: {
                avatar: { description: "Avatar file" },
              },
              relationships: {
                posts: {
                  refType: "Post",
                  refField: "authorId",
                  srcField: "id",
                  array: true,
                  description: "Posts by user",
                },
              },
              permission: {
                create: [],
                read: [
                  {
                    conditions: [],
                    permit: TailorDBType_Permission_Permit.ALLOW,
                    description: "Can read users",
                  },
                ],
                update: [],
                delete: [],
              },
            },
          ),
        ],
        namespace,
      );

      expect(snapshot.types.User).toMatchObject({
        description: "Application user",
        settings: {
          aggregation: true,
          bulkUpsert: true,
          publishEvents: true,
          gqlOperations: { create: false },
        },
        indexes: {
          email_unique: { fields: ["email"], unique: true },
        },
        files: {
          avatar: "Avatar file",
        },
        backwardRelationships: {
          posts: {
            targetType: "Post",
            targetField: "authorId",
            sourceField: "id",
            isArray: true,
            description: "Posts by user",
          },
        },
        permissions: {
          record: {
            read: [{ conditions: [], permit: "allow", description: "Can read users" }],
          },
        },
      });
    });

    test("reconstructs remote GQL permissions", () => {
      const snapshot = createSnapshotFromRemoteTypes(
        [
          createMockRemoteType("Task", {
            id: { type: "uuid", required: true },
            title: { type: "string", required: true },
          }),
        ],
        namespace,
        [createMockRemoteGqlPermission("Task", TailorDBGQLPermission_Permit.ALLOW)],
      );

      expect(snapshot.types.Task?.permissions?.gql).toEqual([
        {
          conditions: [],
          actions: ["read"],
          permit: "allow",
          description: "Can read tasks",
        },
      ]);
    });

    test("normalizes remote validation expressions back to snapshot form", () => {
      const snapshot = createSnapshotFromRemoteTypes(
        [
          createMockRemoteType("User", {
            email: {
              type: "string",
              required: true,
              validate: [
                {
                  action: TailorDBType_PermitAction.DENY,
                  script: { expr: "!value.includes('@')" },
                  errorMessage: "Email is invalid",
                },
              ],
            },
          }),
        ],
        namespace,
      );

      expect(snapshot.types.User?.fields.email?.validate).toEqual([
        {
          script: { expr: "value.includes('@')" },
          errorMessage: "Email is invalid",
        },
      ]);
    });

    test("normalizes remote snapshots once at the schema level", () => {
      const remoteTypes = [
        createMockRemoteType("Order", {
          amount: { type: "decimal", required: true },
        }),
      ];

      const entries = Object.entries;
      const normalizedFieldRecords: unknown[] = [];
      const entriesSpy = vi.spyOn(Object, "entries").mockImplementation((value) => {
        const amountField = (value as Record<string, unknown>).amount;
        // The raw remote fields record always sets `array` explicitly (even to
        // false); the converted SnapshotFieldConfig only sets it when true. This
        // isolates the post-conversion fields record from the pre-conversion one.
        if (amountField && typeof amountField === "object" && !("array" in amountField)) {
          normalizedFieldRecords.push(value);
        }
        return entries(value);
      });
      try {
        createSnapshotFromRemoteTypes(remoteTypes, namespace);
      } finally {
        entriesSpy.mockRestore();
      }

      expect(normalizedFieldRecords).toHaveLength(1);
    });

    test("keeps remote type names that match Object prototype keys", () => {
      const remoteTypes = [
        createMockRemoteType("__proto__", {
          id: { type: "uuid", required: true },
        }),
      ];

      const remoteSnapshot = createSnapshotFromRemoteTypes(remoteTypes, namespace);
      expect(Object.hasOwn(remoteSnapshot.types, "__proto__")).toBe(true);

      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
      };

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts).toEqual([
        {
          typeName: "__proto__",
          kind: "type_missing_local",
          details: "Type '__proto__' exists in remote but not in snapshot",
        },
      ]);
    });

    test("returns empty array when remote and snapshot match exactly", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
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

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          name: { type: "string", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts).toEqual([]);
    });

    test("detects remote drift in type-level schema elements", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              email: { type: "string", required: true, index: true },
            },
            settings: { aggregation: true },
            indexes: {
              email_unique: { fields: ["email"], unique: true },
            },
            files: {
              avatar: "Avatar file",
            },
            backwardRelationships: {
              posts: {
                targetType: "Post",
                targetField: "authorId",
                sourceField: "id",
                isArray: true,
                description: "Posts by user",
              },
            },
            permissions: {
              record: {
                create: [],
                read: [{ conditions: [], permit: "allow" }],
                update: [],
                delete: [],
              },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          email: { type: "string", required: true, index: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);

      expect(drifts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ typeName: "User", kind: "type_settings_mismatch" }),
          expect.objectContaining({ typeName: "User", kind: "index_missing_remote" }),
          expect.objectContaining({ typeName: "User", kind: "file_missing_remote" }),
          expect.objectContaining({ typeName: "User", kind: "relationship_missing_remote" }),
          expect.objectContaining({ typeName: "User", kind: "permission_mismatch" }),
        ]),
      );
    });

    test("detects mismatched type-level schema element configs", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              email: { type: "string", required: true },
            },
            indexes: {
              email_unique: { fields: ["email"], unique: true },
            },
            files: {
              avatar: "Avatar file",
            },
            backwardRelationships: {
              posts: {
                targetType: "Post",
                targetField: "authorId",
                sourceField: "id",
                isArray: true,
                description: "Posts by user",
              },
            },
          },
        },
      };
      const remoteTypes = [
        createMockRemoteType(
          "User",
          {
            id: { type: "uuid", required: true },
            email: { type: "string", required: true },
          },
          {
            indexes: {
              email_unique: { fieldNames: ["email"], unique: false },
            },
            files: {
              avatar: { description: "Remote avatar file" },
            },
            relationships: {
              posts: {
                refType: "Post",
                refField: "writerId",
                srcField: "id",
                array: true,
                description: "Posts by user",
              },
            },
          },
        ),
      ];

      expect(compareRemoteWithSnapshot(remoteTypes, snapshot)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ typeName: "User", kind: "index_mismatch" }),
          expect.objectContaining({ typeName: "User", kind: "file_mismatch" }),
          expect.objectContaining({ typeName: "User", kind: "relationship_mismatch" }),
        ]),
      );
    });

    test("matches explicit GQL operation enable overrides in remote snapshots", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
            },
            settings: { gqlOperations: { create: true } },
          },
        },
      };
      const remoteTypes = [
        createMockRemoteType(
          "User",
          {
            id: { type: "uuid", required: true },
          },
          {
            settings: {
              pluralForm: "users",
              disableGqlOperations: {
                create: false,
                update: false,
                delete: false,
                read: false,
              },
            },
          },
        ),
      ];

      expect(compareRemoteWithSnapshot(remoteTypes, snapshot)).toEqual([]);
    });

    test("detects remote relationship description mismatch", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
            },
            backwardRelationships: {
              posts: {
                targetType: "Post",
                targetField: "authorId",
                sourceField: "id",
                isArray: true,
                description: "Posts by user",
              },
            },
          },
        },
      };
      const remoteTypes = [
        createMockRemoteType(
          "User",
          {
            id: { type: "uuid", required: true },
          },
          {
            relationships: {
              posts: {
                refType: "Post",
                refField: "authorId",
                srcField: "id",
                array: true,
                description: "Published posts by user",
              },
            },
          },
        ),
      ];

      expect(compareRemoteWithSnapshot(remoteTypes, snapshot)).toEqual([
        expect.objectContaining({
          typeName: "User",
          kind: "relationship_mismatch",
          relationshipName: "posts",
          details: expect.stringContaining("description changed"),
        }),
      ]);
    });

    test("treats empty permission blocks as unset during remote comparison", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
            },
            permissions: {
              record: {
                create: [],
                read: [],
                update: [],
                delete: [],
              },
              gql: [],
            },
          },
        },
      };
      const remoteTypes = [
        createMockRemoteType(
          "User",
          {
            id: { type: "uuid", required: true },
          },
          {
            permission: {
              create: [],
              read: [],
              update: [],
              delete: [],
            },
          },
        ),
      ];

      expect(compareRemoteWithSnapshot(remoteTypes, snapshot)).toEqual([]);
    });

    test("uses remote GQL permissions when comparing remote snapshots", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          Task: {
            name: "Task",
            pluralForm: "Tasks",
            fields: {
              id: { type: "uuid", required: true },
              title: { type: "string", required: true },
            },
            permissions: {
              gql: [
                {
                  conditions: [],
                  actions: ["read", "create"],
                  permit: "allow",
                  description: "Can read tasks",
                },
              ],
            },
          },
        },
      };
      const remoteTypes = [
        createMockRemoteType("Task", {
          id: { type: "uuid", required: true },
          title: { type: "string", required: true },
        }),
      ];

      expect(
        compareRemoteWithSnapshot(remoteTypes, snapshot, [
          createMockRemoteGqlPermission("Task", TailorDBGQLPermission_Permit.ALLOW, [
            TailorDBGQLPermission_Action.CREATE,
            TailorDBGQLPermission_Action.READ,
          ]),
        ]),
      ).toEqual([]);

      expect(
        compareRemoteWithSnapshot(remoteTypes, snapshot, [
          createMockRemoteGqlPermission("Task", TailorDBGQLPermission_Permit.DENY),
        ]),
      ).toEqual([expect.objectContaining({ typeName: "Task", kind: "permission_mismatch" })]);
    });

    test("ignores permission policy order when comparing remote snapshots", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          Task: {
            name: "Task",
            pluralForm: "Tasks",
            fields: { id: { type: "uuid", required: true } },
            permissions: {
              record: {
                create: [],
                read: [
                  { conditions: [], permit: "allow", description: "everyone" },
                  { conditions: [], permit: "deny", description: "blocked" },
                ],
                update: [],
                delete: [],
              },
              gql: [
                { conditions: [], actions: ["read"], permit: "allow" },
                { conditions: [], actions: ["create"], permit: "deny" },
              ],
            },
          },
        },
      };
      const remoteTypes = [
        {
          name: "Task",
          schema: {
            fields: {
              id: {
                type: "uuid",
                required: true,
                array: false,
                index: false,
                unique: false,
                foreignKey: false,
                allowedValues: [],
                vector: false,
                validate: [],
                fields: {},
              },
            },
            relationships: {},
            indexes: {},
            files: {},
            settings: { pluralForm: "Tasks" },
            permission: {
              create: [],
              read: [
                {
                  conditions: [],
                  permit: TailorDBType_Permission_Permit.DENY,
                  description: "blocked",
                },
                {
                  conditions: [],
                  permit: TailorDBType_Permission_Permit.ALLOW,
                  description: "everyone",
                },
              ],
              update: [],
              delete: [],
            },
          },
        } as unknown as ProtoTailorDBType,
      ];
      const remoteGqlPermissions = [
        {
          typeName: "Task",
          permission: {
            id: "task-gql-permission",
            policies: [
              {
                conditions: [],
                actions: [TailorDBGQLPermission_Action.CREATE],
                permit: TailorDBGQLPermission_Permit.DENY,
                description: "",
              },
              {
                conditions: [],
                actions: [TailorDBGQLPermission_Action.READ],
                permit: TailorDBGQLPermission_Permit.ALLOW,
                description: "",
              },
            ],
          },
        } as unknown as RemoteGqlPermission,
      ];

      expect(compareRemoteWithSnapshot(remoteTypes, snapshot, remoteGqlPermissions)).toEqual([]);
    });

    test("does not report drift for one-to-one backward relationships", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
            },
            backwardRelationships: {
              profile: {
                targetType: "Profile",
                targetField: "userId",
                sourceField: "id",
                isArray: false,
                description: "",
              },
            },
          },
        },
      };
      const remoteTypes = [
        createMockRemoteType(
          "User",
          {
            id: { type: "uuid", required: true },
          },
          {
            relationships: {
              profile: {
                refType: "Profile",
                refField: "userId",
                srcField: "id",
                array: false,
                description: "",
              },
            },
          },
        ),
      ];

      expect(compareRemoteWithSnapshot(remoteTypes, snapshot)).toEqual([]);
    });

    test("detects type missing in remote", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
          Post: {
            name: "Post",
            pluralForm: "Posts",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("type_missing_remote");
      expect(drifts[0]!.typeName).toBe("Post");
    });

    test("detects type missing in snapshot (unexpected type in remote)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
        }),
        createMockRemoteType("ExtraType", {
          id: { type: "uuid", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("type_missing_local");
      expect(drifts[0]!.typeName).toBe("ExtraType");
    });

    test("detects field missing in remote", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              email: { type: "string", required: false },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("field_missing_remote");
      expect(drifts[0]!.fieldName).toBe("email");
    });

    test("detects field missing in snapshot (unexpected field in remote)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          extraField: { type: "string", required: false },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("field_missing_local");
      expect(drifts[0]!.fieldName).toBe("extraField");
    });

    test("detects field type mismatch", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              age: { type: "number", required: false },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          age: { type: "string", required: false },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("field_mismatch");
      expect(drifts[0]!.fieldName).toBe("age");
      expect(drifts[0]!.details).toContain("type");
    });

    test("detects required flag mismatch", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              name: { type: "string", required: false },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          name: { type: "string", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("field_mismatch");
      expect(drifts[0]!.details).toContain("required");
    });

    test("detects array flag mismatch", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              tags: { type: "string", required: false, array: true },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          tags: { type: "string", required: false, array: false },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("field_mismatch");
      expect(drifts[0]!.details).toContain("array");
    });

    test("detects enum allowedValues mismatch", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          Task: {
            name: "Task",
            pluralForm: "Tasks",
            fields: {
              id: { type: "uuid", required: true },
              status: {
                type: "enum",
                required: true,
                allowedValues: [{ value: "PENDING" }, { value: "DONE" }],
              },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("Task", {
          id: { type: "uuid", required: true },
          status: {
            type: "enum",
            required: true,
            allowedValues: [{ value: "PENDING" }, { value: "IN_PROGRESS" }],
          },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("field_mismatch");
      expect(drifts[0]!.details).toContain("allowedValues");
    });

    test("reports detailed drift for hooks, validation, serial, and nested fields", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              metadata: {
                type: "nested",
                required: false,
                hooks: { create: { expr: "snapshotCreate" } },
                validate: [
                  {
                    script: { expr: "snapshotValid" },
                    errorMessage: "Snapshot validation",
                  },
                ],
                serial: { start: 10, maxValue: 99, format: "S-%02d" },
                fields: {
                  child: { type: "string", required: false },
                },
              },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          metadata: {
            type: "nested",
            required: false,
            hooks: { create: { expr: "remoteCreate" } },
            validate: [
              {
                action: TailorDBType_PermitAction.ALLOW,
                script: { expr: "remoteValid" },
                errorMessage: "Remote validation",
              },
            ],
            serial: { start: 1, maxValue: 9, format: "R-%02d" },
            fields: {
              child: { type: "number", required: false },
            },
          },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts).toHaveLength(1);
      expect(drifts[0]!.kind).toBe("field_mismatch");
      expect(drifts[0]!.details).toContain("hooks.create");
      expect(drifts[0]!.details).toContain("validate[0].script");
      expect(drifts[0]!.details).toContain("serial.start");
      expect(drifts[0]!.details).toContain("fields.child.type");
    });

    test("normalizes decimal scale at compare entry so missing scale matches remote default", () => {
      // The snapshot is written from disk without an explicit scale (legacy /
      // user-authored form). compareRemoteWithSnapshot normalizes the snapshot
      // at entry so it becomes equivalent to a remote that has materialized
      // the platform-default scale of 6.
      const snapshotPath = path.join(testDir, "decimal-default", SCHEMA_FILE_NAME);
      fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
      fs.writeFileSync(
        snapshotPath,
        JSON.stringify({
          version: SCHEMA_SNAPSHOT_VERSION,
          namespace,
          createdAt: new Date().toISOString(),
          types: {
            Order: {
              name: "Order",
              pluralForm: "Orders",
              fields: {
                id: { type: "uuid", required: true },
                amount: { type: "decimal", required: true },
              },
            },
          },
        }),
      );
      const snapshot = loadSnapshot(snapshotPath);

      const remoteTypes = [
        createMockRemoteType("Order", {
          id: { type: "uuid", required: true },
          amount: { type: "decimal", required: true, scale: 6 },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts).toEqual([]);
    });

    test("detects drift when decimal scale differs from snapshot", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          Order: {
            name: "Order",
            pluralForm: "Orders",
            fields: {
              id: { type: "uuid", required: true },
              amount: { type: "decimal", required: true, scale: 6 },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("Order", {
          id: { type: "uuid", required: true },
          amount: { type: "decimal", required: true, scale: 2 },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("field_mismatch");
      expect(drifts[0]!.details).toContain("scale: remote=2, expected=6");
    });

    test("handles empty remote types list", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const drifts = compareRemoteWithSnapshot([], snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("type_missing_remote");
    });

    test("handles empty snapshot types", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("type_missing_local");
    });
  });

  // ==========================================================================
  // formatSchemaDrifts
  // ==========================================================================
  describe("formatSchemaDrifts", () => {
    test("returns 'No schema drifts detected.' for empty array", () => {
      const result = formatSchemaDrifts([]);
      expect(result).toBe("No schema drifts detected.");
    });

    test("formats drifts grouped by type", () => {
      const drifts = [
        {
          typeName: "User",
          kind: "field_missing_remote" as const,
          fieldName: "email",
          details: "Field 'email' exists in snapshot but not in remote",
        },
        {
          typeName: "User",
          kind: "field_mismatch" as const,
          fieldName: "name",
          details: "type: remote=string, expected=text",
        },
        {
          typeName: "Post",
          kind: "type_missing_remote" as const,
          details: "Type 'Post' exists in snapshot but not in remote",
        },
      ];

      const result = formatSchemaDrifts(drifts);
      expect(result).toContain("Type 'User':");
      expect(result).toContain("Field 'email'");
      expect(result).toContain("Field 'name'");
      expect(result).toContain("Type 'Post':");
    });
  });
});
