import * as fs from "node:fs";
import {
  TailorDBGQLPermission_Action,
  TailorDBGQLPermission_Permit,
  TailorDBType_PermitAction,
  TailorDBType_Permission_Permit,
  type TailorDBType as ProtoTailorDBType,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import * as path from "pathe";
import { describe, expect, expectTypeOf, test, aroundEach, aroundAll, vi } from "vitest";
import { buildTypeScripts } from "#/parser/service/tailordb/type-script";
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
  type CompareSnapshotsOptions,
  type NormalizedSchemaSnapshot,
  type RemoteGqlPermission,
  type SchemaSnapshot,
} from "./snapshot";
import type { ParsedField, TailorDBType } from "#/parser/service/tailordb/types";
import type { MigrationDiff, RelationshipAddedChange } from "./diff-calculator";
import type { TailorDBDeployInput } from "./schema-checks";

// compareSnapshots takes normalized snapshots; tests build raw fixtures.
function compareRawSnapshots(
  previous: SchemaSnapshot,
  current: SchemaSnapshot,
  options?: CompareSnapshotsOptions,
): MigrationDiff {
  return compareSnapshots(
    normalizeSchemaSnapshot(previous),
    normalizeSchemaSnapshot(current),
    options,
  );
}

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
      expect(snapshot.tables.User).toBeDefined();
      expect(snapshot.tables.User!.name).toBe("User");
      expect(snapshot.tables.User!.fields.id).toBeDefined();
      expect(snapshot.tables.User!.fields.name).toBeDefined();
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

      expect(snapshot.tables.Product!.fields.sku!.required).toBe(true);
      expect(snapshot.tables.Product!.fields.sku!.unique).toBe(true);
      expect(snapshot.tables.Product!.fields.tags!.array).toBe(true);
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

      expect(snapshot.tables.Order!.fields.customerId!.foreignKey).toBe(true);
      expect(snapshot.tables.Order!.fields.customerId!.foreignKeyType).toBe("Customer");
      expect(snapshot.tables.Order!.fields.customerId!.foreignKeyField).toBe("id");
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

      expect(snapshot.tables.Task!.fields.status!.type).toBe("enum");
      expect(snapshot.tables.Task!.fields.status!.allowedValues).toEqual([
        { value: "PENDING" },
        { value: "IN_PROGRESS" },
        { value: "DONE" },
      ]);
    });

    test("handles empty types object", () => {
      const mockTypes: Record<string, TailorDBType> = {};
      const snapshot = createSnapshotFromLocalTypes(mockTypes, namespace);

      expect(snapshot.version).toBe(SCHEMA_SNAPSHOT_VERSION);
      expect(snapshot.tables).toEqual({});
    });
  });

  describe("normalizeSchemaSnapshot", () => {
    test("normalizes legacy type and nested field defaults in one pass", () => {
      const snapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
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
      // A snapshot keys its tables under `tables`; a deploy input keys its
      // parsed types under `types`. Spreading one over the other type-checks
      // either way, so pin the distinction here.
      expectTypeOf<SchemaSnapshot>().not.toHaveProperty("types");
      expectTypeOf<TailorDBDeployInput>().toHaveProperty("types");
      expectTypeOf<TailorDBDeployInput>().not.toHaveProperty("tables");
      expect(normalized.tables.Product?.pluralForm).toBe("Products");
      expect(normalized.tables.Product?.fields.price?.scale).toBe(6);
      expect(normalized.tables.Product?.fields.metadata?.fields?.discount?.scale).toBe(6);

      // Original snapshot must remain unmutated (the footgun this behavior fixes)
      expect(snapshot.tables.Product?.pluralForm).toBeUndefined();
      expect(snapshot.tables.Product?.fields.price?.scale).toBeUndefined();
      expect(snapshot.tables.Product?.fields.metadata?.fields?.discount?.scale).toBeUndefined();
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
      tables: {},
    });

    test("detects type addition", () => {
      const previous = createEmptySnapshot();
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          NewType: {
            name: "NewType",
            pluralForm: "NewTypes",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes.length).toBe(1);
      expect(diff.changes[0]!.kind).toBe("table_added");
      expect(diff.changes[0]!.tableName).toBe("NewType");
      expect(diff.hasBreakingChanges).toBe(false);
    });

    test("detects type removal (non-breaking)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          OldType: {
            name: "OldType",
            pluralForm: "OldTypes",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const current = createEmptySnapshot();

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes[0]!.kind).toBe("table_removed");
      expect(diff.hasBreakingChanges).toBe(false);
      expect(diff.requiresMigrationScript).toBe(false);
      expect(diff.hasWarnings).toBe(true);
      expect(diff.warnings).toEqual([
        {
          tableName: "OldType",
          reason:
            "Table removed (all records in this table will be deleted during post-migration cleanup)",
        },
      ]);
    });

    test("detects field addition (optional - non-breaking)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
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

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes[0]).toMatchObject({ kind: "field_added", fieldName: "email" });
      expect(diff.hasBreakingChanges).toBe(false);
    });

    test("detects field addition (required - breaking change)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
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

      const diff = compareRawSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0]!.reason).toBe("Required field added");
    });

    test("detects field removal (non-breaking)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
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
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes[0]!.kind).toBe("field_removed");
      expect(diff.hasBreakingChanges).toBe(false);
      expect(diff.requiresMigrationScript).toBe(false);
      expect(diff.hasWarnings).toBe(true);
      expect(diff.warnings).toEqual([
        {
          tableName: "User",
          fieldName: "name",
          reason: "Field removed (existing data will no longer be accessible through the schema)",
        },
      ]);
    });

    test("supports cast-compatible field type changes with a migration script", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
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
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              age: { type: "float", required: false },
            },
          },
        },
      };

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes[0]!.kind).toBe("field_type_modified");
      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.requiresMigrationScript).toBe(true);
      expect(diff.breakingChanges[0]!.reason).toContain("Field type changed");
      expect(diff.breakingChanges[0]!.unsupported).toBeUndefined();
    });

    test("rejects cast-incompatible field type changes", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              enabled: { type: "boolean", required: false },
            },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              enabled: { type: "integer", required: false },
            },
          },
        },
      };

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes[0]!.kind).toBe("field_type_modified");
      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0]!.unsupported).toBe(true);
    });

    test("normalizes decimal scale so missing scale matches platform default", () => {
      // Reproduces the production scenario where one snapshot was loaded from
      // an older file that omitted `scale` and the other was produced by
      // `createSnapshotType` (which materializes the platform default of 6).
      // Normalization canonicalizes both inputs before comparing, so the diff
      // must come out empty even though the literal shapes differ.
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
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

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes).toEqual([]);
      expect(diff.hasBreakingChanges).toBe(false);
    });

    test("detects required flag change (optional to required - breaking)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
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
        tables: {
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

      const diff = compareRawSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0]!.reason).toContain("optional to required");
    });

    test("detects array to single value change (breaking change)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
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
        tables: {
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

      const diff = compareRawSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0]!.reason).toContain("array to single value");
    });

    test("detects unique constraint addition (breaking change)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
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
        tables: {
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

      const diff = compareRawSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0]!.reason).toContain("Unique constraint");
    });

    describe("field renames", () => {
      function snapshotWithFields(
        fields: Record<string, { type: string; required: boolean; array?: boolean }>,
      ): SchemaSnapshot {
        return {
          ...createEmptySnapshot(),
          tables: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: { id: { type: "uuid", required: true }, ...fields },
            },
          },
        };
      }

      const previous = () => snapshotWithFields({ fullName: { type: "string", required: false } });
      const current = () =>
        snapshotWithFields({ displayName: { type: "string", required: false } });

      test("records a single breaking field_renamed change", () => {
        const diff = compareRawSnapshots(previous(), current(), {
          fieldRenames: [
            { tableName: "User", previousFieldName: "fullName", fieldName: "displayName" },
          ],
        });

        expect(diff.changes).toEqual([
          {
            kind: "field_renamed",
            tableName: "User",
            fieldName: "displayName",
            previousFieldName: "fullName",
            before: { type: "string", required: false },
            after: { type: "string", required: false },
          },
        ]);
        expect(diff.hasBreakingChanges).toBe(true);
        expect(diff.requiresMigrationScript).toBe(true);
        expect(diff.breakingChanges).toEqual([
          {
            tableName: "User",
            fieldName: "displayName",
            reason:
              "Field renamed from fullName to displayName (existing values must be copied by the migration script)",
          },
        ]);
        expect(diff.warnings).toEqual([]);
      });

      test("without rename specs the same pair stays remove + add", () => {
        const diff = compareRawSnapshots(previous(), current());

        expect(diff.changes.map((c) => c.kind).toSorted()).toEqual([
          "field_added",
          "field_removed",
        ]);
        expect(diff.hasBreakingChanges).toBe(false);
        expect(diff.requiresMigrationScript).toBe(false);
      });

      test("rejects a rename whose old field is missing from the previous schema", () => {
        expect(() =>
          compareRawSnapshots(previous(), current(), {
            fieldRenames: [
              { tableName: "User", previousFieldName: "nickname", fieldName: "displayName" },
            ],
          }),
        ).toThrow('field "nickname" does not exist in the previous schema');
      });

      test("rejects a rename whose new field is missing from the current schema", () => {
        expect(() =>
          compareRawSnapshots(previous(), current(), {
            fieldRenames: [
              { tableName: "User", previousFieldName: "fullName", fieldName: "alias" },
            ],
          }),
        ).toThrow('field "alias" does not exist in the current schema');
      });

      test("rejects a rename between incompatible field types", () => {
        const incompatibleCurrent = snapshotWithFields({
          displayName: { type: "integer", required: false },
        });
        expect(() =>
          compareRawSnapshots(previous(), incompatibleCurrent, {
            fieldRenames: [
              { tableName: "User", previousFieldName: "fullName", fieldName: "displayName" },
            ],
          }),
        ).toThrow("not rename-compatible");
      });

      test("rejects a rename between different array-ness", () => {
        const arrayCurrent = snapshotWithFields({
          displayName: { type: "string", required: false, array: true },
        });
        expect(() =>
          compareRawSnapshots(previous(), arrayCurrent, {
            fieldRenames: [
              { tableName: "User", previousFieldName: "fullName", fieldName: "displayName" },
            ],
          }),
        ).toThrow("not rename-compatible");
      });

      test("rejects a field participating in two renames", () => {
        expect(() =>
          compareRawSnapshots(previous(), current(), {
            fieldRenames: [
              { tableName: "User", previousFieldName: "fullName", fieldName: "displayName" },
              { tableName: "User", previousFieldName: "fullName", fieldName: "displayName" },
            ],
          }),
        ).toThrow("appears in more than one rename");
      });

      test("rejects a rename whose type does not exist", () => {
        expect(() =>
          compareRawSnapshots(previous(), current(), {
            fieldRenames: [
              { tableName: "Ghost", previousFieldName: "fullName", fieldName: "displayName" },
            ],
          }),
        ).toThrow('table "Ghost" must exist');
      });
    });

    describe("type renames", () => {
      function snapshotWithType(name: string, pluralForm: string): SchemaSnapshot {
        return {
          ...createEmptySnapshot(),
          tables: {
            [name]: {
              name,
              pluralForm,
              fields: {
                id: { type: "uuid", required: true },
                email: { type: "string", required: false },
              },
            },
          },
        };
      }

      const previous = () => snapshotWithType("User", "Users");
      const current = () => snapshotWithType("Person", "People");
      const rename = { previousTableName: "User", tableName: "Person" };

      test("records a single breaking type_renamed change", () => {
        const diff = compareRawSnapshots(previous(), current(), { typeRenames: [rename] });

        expect(diff.changes).toHaveLength(1);
        expect(diff.changes[0]).toMatchObject({
          kind: "table_renamed",
          tableName: "Person",
          previousTableName: "User",
          before: { name: "User" },
          after: { name: "Person" },
        });
        expect(diff.hasBreakingChanges).toBe(true);
        expect(diff.requiresMigrationScript).toBe(true);
        expect(diff.breakingChanges).toHaveLength(2);
        expect(diff.breakingChanges[0]!.reason).toContain(
          "Table renamed from User to Person (existing records must be copied by the migration script)",
        );
        expect(diff.breakingChanges[1]!.reason).toContain("GraphQL API names");
        expect(diff.breakingChanges[1]!.reason).toContain("User/Users");
        expect(diff.breakingChanges[1]!.reason).toContain("Person/People");
        expect(diff.warnings).toEqual([]);
      });

      test("without rename specs the same pair stays remove + add with a warning", () => {
        const diff = compareRawSnapshots(previous(), current());

        expect(diff.changes.map((c) => c.kind).toSorted()).toEqual([
          "table_added",
          "table_removed",
        ]);
        expect(diff.hasBreakingChanges).toBe(false);
        expect(diff.requiresMigrationScript).toBe(false);
        expect(diff.warnings).toHaveLength(1);
      });

      test("does not flag a foreign key retarget that follows the rename", () => {
        const withOrder = (base: SchemaSnapshot, target: string): SchemaSnapshot => ({
          ...base,
          tables: {
            ...base.tables,
            Order: {
              name: "Order",
              pluralForm: "Orders",
              fields: {
                id: { type: "uuid", required: true },
                ownerId: {
                  type: "uuid",
                  required: false,
                  foreignKey: true,
                  foreignKeyType: target,
                  foreignKeyField: "id",
                },
              },
            },
          },
        });

        const diff = compareRawSnapshots(
          withOrder(previous(), "User"),
          withOrder(current(), "Person"),
          { typeRenames: [rename] },
        );

        const orderChanges = diff.changes.filter((c) => c.tableName === "Order");
        expect(orderChanges.map((c) => c.kind)).toEqual(["field_modified"]);
        expect(diff.breakingChanges.filter((bc) => bc.tableName === "Order")).toEqual([]);
      });

      test("still flags a foreign key retarget unrelated to the rename", () => {
        const withOrder = (base: SchemaSnapshot, target: string): SchemaSnapshot => ({
          ...base,
          tables: {
            ...base.tables,
            Team: {
              name: "Team",
              pluralForm: "Teams",
              fields: { id: { type: "uuid", required: true } },
            },
            Order: {
              name: "Order",
              pluralForm: "Orders",
              fields: {
                id: { type: "uuid", required: true },
                ownerId: {
                  type: "uuid",
                  required: false,
                  foreignKey: true,
                  foreignKeyType: target,
                  foreignKeyField: "id",
                },
              },
            },
          },
        });

        const diff = compareRawSnapshots(
          withOrder(previous(), "Team"),
          withOrder(current(), "Team2"),
          { typeRenames: [rename] },
        );

        expect(
          diff.breakingChanges.some(
            (bc) => bc.tableName === "Order" && bc.reason.includes("Foreign key target type"),
          ),
        ).toBe(true);
      });

      test("rejects a rename between incompatible type shapes", () => {
        const incompatible: SchemaSnapshot = {
          ...createEmptySnapshot(),
          tables: {
            Person: {
              name: "Person",
              pluralForm: "People",
              fields: { id: { type: "uuid", required: true } },
            },
          },
        };
        expect(() =>
          compareRawSnapshots(previous(), incompatible, { typeRenames: [rename] }),
        ).toThrow("not rename-compatible");
      });

      test("rejects a rename whose old type is missing from the previous schema", () => {
        expect(() =>
          compareRawSnapshots(previous(), current(), {
            typeRenames: [{ previousTableName: "Ghost", tableName: "Person" }],
          }),
        ).toThrow('table "Ghost" does not exist in the previous schema');
      });
    });

    describe("decimal scale changes", () => {
      function snapshotWithPrice(scale: number | undefined): SchemaSnapshot {
        return {
          ...createEmptySnapshot(),
          tables: {
            Item: {
              name: "Item",
              pluralForm: "Items",
              fields: {
                id: { type: "uuid", required: true },
                price: {
                  type: "decimal",
                  required: true,
                  ...(scale !== undefined && { scale }),
                },
              },
            },
          },
        };
      }

      test("classifies a decimal scale change as breaking", () => {
        const diff = compareRawSnapshots(snapshotWithPrice(2), snapshotWithPrice(4));

        expect(diff.hasBreakingChanges).toBe(true);
        expect(diff.breakingChanges[0]!.reason).toContain("Decimal scale changed");
        expect(diff.requiresMigrationScript).toBe(true);
      });

      test("collects every reason for combined decimal field changes", () => {
        const previous = snapshotWithPrice(4);
        previous.tables.Item!.fields.price = {
          type: "decimal",
          required: false,
          unique: false,
          scale: 4,
        };
        const current = snapshotWithPrice(2);
        current.tables.Item!.fields.price = {
          type: "decimal",
          required: true,
          unique: true,
          scale: 2,
        };

        const diff = compareRawSnapshots(previous, current);

        expect(diff.breakingChanges.map(({ reason }) => reason)).toEqual([
          "Field changed from optional to required",
          "Unique constraint added to field",
          "Decimal scale changed from 4 to 2",
        ]);
      });

      test("does not flag an explicit scale equal to the platform default", () => {
        const diff = compareRawSnapshots(snapshotWithPrice(undefined), snapshotWithPrice(6));

        expect(diff.changes).toHaveLength(0);
        expect(diff.hasBreakingChanges).toBe(false);
      });

      test("classifies a change from the omitted default scale as breaking", () => {
        const diff = compareRawSnapshots(snapshotWithPrice(undefined), snapshotWithPrice(2));

        expect(diff.hasBreakingChanges).toBe(true);
        expect(diff.breakingChanges[0]!.reason).toContain("Decimal scale changed");
      });
    });

    describe("table-level index changes", () => {
      function snapshotWithIndexes(
        indexes: Record<string, { fields: string[]; unique?: boolean }> | undefined,
      ): SchemaSnapshot {
        return {
          ...createEmptySnapshot(),
          tables: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: {
                id: { type: "uuid", required: true },
                name: { type: "string", required: true },
                org: { type: "string", required: true },
              },
              ...(indexes && { indexes }),
            },
          },
        };
      }

      test("classifies unique index addition as breaking", () => {
        const diff = compareRawSnapshots(
          snapshotWithIndexes(undefined),
          snapshotWithIndexes({ name_org: { fields: ["name", "org"], unique: true } }),
        );

        expect(diff.hasBreakingChanges).toBe(true);
        expect(diff.breakingChanges[0]!.reason).toContain("Unique constraint added to index");
        expect(diff.requiresMigrationScript).toBe(true);
      });

      test("keeps non-unique index addition non-breaking", () => {
        const diff = compareRawSnapshots(
          snapshotWithIndexes(undefined),
          snapshotWithIndexes({ name_org: { fields: ["name", "org"] } }),
        );

        expect(diff.hasBreakingChanges).toBe(false);
        expect(diff.requiresMigrationScript).toBe(false);
        expect(diff.changes.some((c) => c.kind === "index_added")).toBe(true);
      });

      test("classifies unique constraint added to existing index as breaking", () => {
        const diff = compareRawSnapshots(
          snapshotWithIndexes({ name_org: { fields: ["name", "org"], unique: false } }),
          snapshotWithIndexes({ name_org: { fields: ["name", "org"], unique: true } }),
        );

        expect(diff.hasBreakingChanges).toBe(true);
        expect(diff.breakingChanges[0]!.reason).toContain("Unique constraint added to index");
      });

      test("classifies field change on a unique index as breaking", () => {
        const diff = compareRawSnapshots(
          snapshotWithIndexes({ name_org: { fields: ["name"], unique: true } }),
          snapshotWithIndexes({ name_org: { fields: ["name", "org"], unique: true } }),
        );

        expect(diff.hasBreakingChanges).toBe(true);
        expect(diff.breakingChanges[0]!.reason).toContain("Unique index fields changed");
      });

      test("keeps unique constraint removal non-breaking", () => {
        const diff = compareRawSnapshots(
          snapshotWithIndexes({ name_org: { fields: ["name", "org"], unique: true } }),
          snapshotWithIndexes({ name_org: { fields: ["name", "org"], unique: false } }),
        );

        expect(diff.hasBreakingChanges).toBe(false);
        expect(diff.requiresMigrationScript).toBe(false);
      });

      test("keeps unique index removal non-breaking", () => {
        const diff = compareRawSnapshots(
          snapshotWithIndexes({ name_org: { fields: ["name", "org"], unique: true } }),
          snapshotWithIndexes(undefined),
        );

        expect(diff.hasBreakingChanges).toBe(false);
        expect(diff.requiresMigrationScript).toBe(false);
      });

      test("keeps field change on a non-unique index non-breaking", () => {
        const diff = compareRawSnapshots(
          snapshotWithIndexes({ name_org: { fields: ["name"] } }),
          snapshotWithIndexes({ name_org: { fields: ["name", "org"] } }),
        );

        expect(diff.hasBreakingChanges).toBe(false);
        expect(diff.requiresMigrationScript).toBe(false);
      });
    });

    test("detects enum values removal (breaking change)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
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
        tables: {
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

      const diff = compareRawSnapshots(previous, current);

      expect(diff.hasBreakingChanges).toBe(true);
      expect(diff.breakingChanges[0]!.reason).toContain("Enum values removed");
      expect(diff.breakingChanges[0]!.reason).toContain("CANCELLED");
    });

    test("does not detect change when enum values are reordered", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
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
        tables: {
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

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes.length).toBe(0);
      expect(diff.hasBreakingChanges).toBe(false);
    });

    test("detects change when enum values are added (regardless of order)", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
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
        tables: {
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

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes.length).toBe(1);
      expect(diff.changes[0]!.kind).toBe("field_modified");
      expect(diff.hasBreakingChanges).toBe(false);
    });

    test("returns empty diff when no changes", () => {
      const snapshot: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff = compareRawSnapshots(snapshot, snapshot);

      expect(diff.changes.length).toBe(0);
    });

    test("detects type settings changes", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
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
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            settings: { bulkUpsert: true, gqlOperations: { create: false } },
          },
        },
      };

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes).toEqual([
        expect.objectContaining({
          kind: "table_settings_modified",
          tableName: "User",
          reason: expect.stringContaining("settings changed"),
        }),
      ]);
    });

    test("detects explicit GQL operation enable overrides", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            settings: { gqlOperations: { create: true } },
          },
        },
      };

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes).toEqual([
        expect.objectContaining({
          kind: "table_settings_modified",
          tableName: "User",
          reason: expect.stringContaining("settings changed"),
        }),
      ]);
    });

    test("detects explicit empty GQL operation overrides", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            settings: { gqlOperations: {} },
          },
        },
      };

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes).toEqual([
        expect.objectContaining({
          kind: "table_settings_modified",
          tableName: "User",
          reason: expect.stringContaining("settings changed"),
        }),
      ]);
    });

    test("includes relationshipType in relationship_added changes", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
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

      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
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

      const diff = compareRawSnapshots(previous, current);

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
        tables: {
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
        tables: {
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

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes).toEqual([
        expect.objectContaining({
          kind: "relationship_modified",
          tableName: "User",
          relationshipName: "posts",
          relationshipType: "backward",
          reason: expect.stringContaining("description changed"),
        }),
      ]);
    });

    test("detects typeHookExpr addition", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            typeHookExpr: { create: "({input}) => ({fullName: input.first + input.last})" },
          },
        },
      };

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes).toEqual([
        expect.objectContaining({
          kind: "table_scripts_modified",
          tableName: "User",
          before: {},
          after: {
            typeHookExpr: {
              create: "({input}) => ({fullName: input.first + input.last})",
            },
          },
        }),
      ]);
    });

    test("detects typeHookExpr removal", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            typeHookExpr: { create: "old-expr" },
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes).toEqual([
        expect.objectContaining({
          kind: "table_scripts_modified",
          tableName: "User",
          before: { typeHookExpr: { create: "old-expr" } },
          after: {},
        }),
      ]);
    });

    test("detects typeValidateExpr change", () => {
      const previous: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            typeValidateExpr: "old-validate",
          },
        },
      };
      const current: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            typeValidateExpr: "new-validate",
          },
        },
      };

      const diff = compareRawSnapshots(previous, current);

      expect(diff.changes).toEqual([
        expect.objectContaining({
          kind: "table_scripts_modified",
          tableName: "User",
          before: { typeValidateExpr: "old-validate" },
          after: { typeValidateExpr: "new-validate" },
        }),
      ]);
    });

    test("no diff when typeHookExpr unchanged", () => {
      const snapshot: SchemaSnapshot = {
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
            typeHookExpr: { create: "same-expr", update: "same-update" },
            typeValidateExpr: "same-validate",
          },
        },
      };

      const diff = compareRawSnapshots(snapshot, snapshot);

      expect(diff.changes).toEqual([]);
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
        tables: {
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

      const snapshotTypes = createSnapshotFromLocalTypes(localTypes, namespace).tables;
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
        tables: {
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
      expect(loaded.tables.User).toBeDefined();
    });

    test("reads a legacy types key as tables", () => {
      const legacySnapshot = {
        version: 4,
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

      const filePath = path.join(testDir, "legacy_types_schema.json");
      fs.writeFileSync(filePath, JSON.stringify(legacySnapshot, null, 2));

      const loaded = loadSnapshot(filePath);

      expect(Object.keys(loaded.tables)).toEqual(["User"]);
      expect(loaded.tables.User?.name).toBe("User");
    });

    test("keeps the current key when a snapshot carries both", () => {
      const table = (name: string) => ({
        [name]: {
          name,
          pluralForm: `${name}s`,
          fields: { id: { type: "uuid", required: true } },
        },
      });
      const filePath = path.join(testDir, "both_keys_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: SCHEMA_SNAPSHOT_VERSION,
          namespace,
          createdAt: new Date().toISOString(),
          types: table("Legacy"),
          tables: table("Current"),
        }),
      );

      expect(Object.keys(loadSnapshot(filePath).tables)).toEqual(["Current"]);
    });

    test("preserves unrecognized keys when normalizing a legacy types key", () => {
      const legacySnapshot = {
        version: 2,
        namespace,
        createdAt: new Date().toISOString(),
        futureKey: { nested: true },
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const filePath = path.join(testDir, "legacy_types_extra_schema.json");
      fs.writeFileSync(filePath, JSON.stringify(legacySnapshot, null, 2));

      const loaded = loadSnapshot(filePath) as NormalizedSchemaSnapshot & {
        futureKey?: { nested: boolean };
      };

      expect(loaded.version).toBe(2);
      expect(loaded.futureKey).toEqual({ nested: true });
      expect(Object.keys(loaded.tables)).toEqual(["User"]);
    });

    test("keeps a legacy __proto__ table name through types normalization", () => {
      const types = Object.create(null) as Record<string, unknown>;
      types["__proto__"] = {
        name: "__proto__",
        pluralForm: "__proto__",
        fields: { id: { type: "uuid", required: true } },
      };
      const filePath = path.join(testDir, "legacy_proto_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 4,
          namespace,
          createdAt: new Date().toISOString(),
          types,
        }),
      );

      const loaded = loadSnapshot(filePath);

      expect(Object.keys(loaded.tables)).toEqual(["__proto__"]);
    });

    test("preserves type names that match Object prototype keys", () => {
      const tables = Object.create(null) as SchemaSnapshot["tables"];
      tables["__proto__"] = {
        name: "__proto__",
        pluralForm: "__proto__",
        fields: { id: { type: "uuid", required: true } },
      };
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables,
      };

      const filePath = path.join(testDir, "proto_schema.json");
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

      const loaded = loadSnapshot(filePath);

      expect(Object.hasOwn(loaded.tables, "__proto__")).toBe(true);
      expect(loaded.tables["__proto__"]?.fields.id).toBeDefined();
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
            kind: "table_added",
            tableName: "NewType",
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
      expect(loaded.changes[0]!.kind).toBe("table_added");
    });

    test("loads a phased field type change", () => {
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

      const filePath = path.join(testDir, "type_change_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(diff, null, 2));

      expect(loadDiff(filePath).changes[0]!.kind).toBe("field_type_modified");
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
            kind: "table_added",
            tableName: "NewType",
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

    test("reads legacy typeName across changes, breakingChanges, and warnings", () => {
      const legacyDiff = {
        version: 3,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_removed",
            typeName: "User",
            fieldName: "legacyCode",
            before: { type: "string" },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [{ typeName: "User", fieldName: "legacyCode", reason: "Field removed" }],
        hasWarnings: true,
        warnings: [{ typeName: "User", fieldName: "legacyCode", reason: "Field removed" }],
        requiresMigrationScript: true,
      };

      const filePath = path.join(testDir, "legacy_type_name_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(legacyDiff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.changes[0]!.tableName).toBe("User");
      expect(loaded.breakingChanges[0]!.tableName).toBe("User");
      expect(loaded.warnings[0]!.tableName).toBe("User");
    });

    test("reads legacy previousTypeName on a rename change", () => {
      const legacyDiff = {
        version: 3,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_renamed",
            typeName: "Member",
            previousTypeName: "User",
            before: { name: "User", pluralForm: "Users", fields: {} },
            after: { name: "Member", pluralForm: "Members", fields: {} },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "legacy_previous_type_name_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(legacyDiff, null, 2));

      const change = loadDiff(filePath).changes[0]!;

      expect(change.tableName).toBe("Member");
      expect(change.kind === "table_renamed" && change.previousTableName).toBe("User");
    });

    test("preserves unrecognized keys and version when normalizing legacy field names", () => {
      const legacyDiff = {
        version: 2,
        namespace,
        createdAt: new Date().toISOString(),
        description: "hand-written note",
        futureKey: { nested: true },
        changes: [
          {
            kind: "type_added",
            typeName: "NewType",
            unknownChangeKey: 42,
            after: { name: "NewType", pluralForm: "NewTypes", fields: {} },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "legacy_roundtrip_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(legacyDiff, null, 2));

      const loaded = loadDiff(filePath) as MigrationDiff & {
        description?: string;
        futureKey?: { nested: boolean };
      };

      expect(loaded.version).toBe(2);
      expect(loaded.description).toBe("hand-written note");
      expect(loaded.futureKey).toEqual({ nested: true });
      expect(loaded.changes[0]!.kind).toBe("table_added");
      expect(loaded.changes[0]!.tableName).toBe("NewType");
      expect((loaded.changes[0] as { unknownChangeKey?: number }).unknownChangeKey).toBe(42);
    });

    test("keeps a current-format diff.json unchanged", () => {
      const currentDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_added",
            tableName: "NewType",
            after: { name: "NewType", pluralForm: "NewTypes", fields: {} },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "current_table_name_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(currentDiff, null, 2));

      expect(loadDiff(filePath).changes[0]!.tableName).toBe("NewType");
    });

    test("rejects a diff.json whose tableName is not a string", () => {
      const malformed = {
        version: 3,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_added",
            tableName: 123,
            after: { name: "NewType", pluralForm: "NewTypes", fields: {} },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "malformed_type_name_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(malformed, null, 2));

      expect(() => loadDiff(filePath)).toThrow(/Invalid migration diff/);
    });

    test("derives warnings from removal changes in a legacy diff.json", () => {
      // Legacy diff.json written before warning-tier support: removals are
      // recorded in changes but the warnings field does not exist yet.
      const legacyDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_removed",
            tableName: "User",
            fieldName: "legacyCode",
            before: { type: "string" },
          },
          {
            kind: "table_removed",
            tableName: "OldType",
            before: { name: "OldType", pluralForm: "OldTypes", fields: {} },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "legacy_removal_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(legacyDiff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.hasWarnings).toBe(true);
      expect(loaded.warnings).toEqual([
        {
          tableName: "User",
          fieldName: "legacyCode",
          reason: "Field removed (existing data will no longer be accessible through the schema)",
        },
        {
          tableName: "OldType",
          reason:
            "Table removed (all records in this table will be deleted during post-migration cleanup)",
        },
      ]);
    });

    test("keeps a recorded empty warnings array authoritative over changes", () => {
      const diff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_removed",
            tableName: "User",
            fieldName: "legacyCode",
            before: { type: "string" },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "recorded_empty_warnings_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(diff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.hasWarnings).toBe(false);
      expect(loaded.warnings).toEqual([]);
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
            tableName: "Product",
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

    test("loads a diff containing a type_renamed change", () => {
      const renameDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
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
        breakingChanges: [
          {
            tableName: "Person",
            reason: "Table renamed from User to Person",
          },
        ],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: true,
      };

      const filePath = path.join(testDir, "type_rename_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(renameDiff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.changes).toEqual(renameDiff.changes);
      expect(loaded.requiresMigrationScript).toBe(true);
    });

    test("loads a diff containing a field_renamed change", () => {
      const renameDiff = {
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

      const filePath = path.join(testDir, "rename_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(renameDiff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.changes).toEqual(renameDiff.changes);
      expect(loaded.requiresMigrationScript).toBe(true);
    });

    describe("legacy type_* change kinds", () => {
      const snapshotType = (name: string) => ({ name, pluralForm: `${name}s`, fields: {} });
      const settingsState = (pluralForm: string) => ({ pluralForm });

      // Payloads carry the legacy `typeName` spelling because that is the only
      // shape a pre-rename diff.json actually has on disk.
      const LEGACY_CHANGES = [
        ["type_added", "table_added", { typeName: "User", after: snapshotType("User") }],
        ["type_removed", "table_removed", { typeName: "OldUser", before: snapshotType("OldUser") }],
        [
          "type_renamed",
          "table_renamed",
          {
            typeName: "Person",
            previousTypeName: "User",
            before: snapshotType("User"),
            after: snapshotType("Person"),
          },
        ],
        ["type_modified", "table_modified", { typeName: "User" }],
        [
          "type_settings_modified",
          "table_settings_modified",
          {
            typeName: "User",
            before: settingsState("Users"),
            after: settingsState("People"),
          },
        ],
        [
          "type_scripts_modified",
          "table_scripts_modified",
          { typeName: "User", before: {}, after: { typeValidateExpr: "() => true" } },
        ],
      ] as const;

      test.each(LEGACY_CHANGES)("normalizes %s to %s", (legacyKind, currentKind, changePayload) => {
        const legacyDiff = {
          version: 2,
          namespace,
          createdAt: new Date().toISOString(),
          changes: [{ kind: legacyKind, ...changePayload }],
          hasBreakingChanges: false,
          breakingChanges: [],
          hasWarnings: false,
          warnings: [],
          requiresMigrationScript: false,
        };

        const filePath = path.join(testDir, `legacy_${legacyKind}_diff.json`);
        fs.writeFileSync(filePath, JSON.stringify(legacyDiff, null, 2));

        const change = loadDiff(filePath).changes[0]!;

        expect(change.kind).toBe(currentKind);
        expect(change.tableName).toBe(changePayload.typeName);
      });
    });
  });

  describe("loadSnapshot validation", () => {
    test.each([1, 2, 3])("loads supported snapshot format version %s", (version) => {
      const filePath = path.join(testDir, `v${version}_schema.json`);
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version,
          namespace,
          createdAt: new Date().toISOString(),
          types: { User: { name: "User", pluralForm: "Users", fields: {} } },
        }),
      );

      expect(loadSnapshot(filePath).version).toBe(version);
    });

    test("loads a valid rebaseline history marker", () => {
      const filePath = path.join(testDir, "rebaseline_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: SCHEMA_SNAPSHOT_VERSION,
          namespace,
          createdAt: new Date().toISOString(),
          types: {},
          rebaseline: {
            historyId: "hcurrent",
            replacedHistoryId: "hprevious",
            replacedLatestMigration: 42,
          },
        }),
      );

      expect(loadSnapshot(filePath).rebaseline).toEqual({
        historyId: "hcurrent",
        replacedHistoryId: "hprevious",
        replacedLatestMigration: 42,
      });
    });

    test.each([
      ["historyId", { historyId: "INVALID!", replacedHistoryId: null, replacedLatestMigration: 1 }],
      [
        "replacedHistoryId",
        { historyId: "hcurrent", replacedHistoryId: "INVALID!", replacedLatestMigration: 1 },
      ],
      [
        "replacedLatestMigration",
        { historyId: "hcurrent", replacedHistoryId: null, replacedLatestMigration: 10_000 },
      ],
    ])("rejects an invalid rebaseline marker at %s", (field, rebaseline) => {
      const filePath = path.join(testDir, `invalid_rebaseline_${field}_schema.json`);
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: SCHEMA_SNAPSHOT_VERSION,
          namespace,
          createdAt: new Date().toISOString(),
          types: {},
          rebaseline,
        }),
      );

      expect(() => loadSnapshot(filePath)).toThrow(field);
    });

    test("rejects snapshot formats older than the supported window", () => {
      const version = 0;
      const filePath = path.join(testDir, `unsupported_v${version}_schema.json`);
      fs.writeFileSync(filePath, JSON.stringify({ version }));

      expect(() => loadSnapshot(filePath)).toThrow(/supports migration file format versions 1-5/);
      expect(() => loadSnapshot(filePath)).toThrow(
        /re-baseline with an SDK that still supports this migration history, then upgrade/i,
      );
    });

    test("rejects snapshot formats newer than the supported window", () => {
      const version = 6;
      const filePath = path.join(testDir, `unsupported_v${version}_schema.json`);
      fs.writeFileSync(filePath, JSON.stringify({ version }));

      expect(() => loadSnapshot(filePath)).toThrow(/supports migration file format versions 1-5/);
      expect(() => loadSnapshot(filePath)).toThrow(
        /upgrade to an SDK that supports migration file format version 6/i,
      );
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
      expect(loaded.tables.User?.fields.name?.required).toBe(true);
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
      expect(loaded.tables.User?.permissions?.record?.create).toHaveLength(1);
      expect(loaded.tables.User?.permissions?.record?.update).toEqual([]);
      expect(loaded.tables.User?.permissions?.record?.delete).toEqual([]);
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
      expect(loaded.tables.Product?.name).toBe("Product");
      // pluralForm is backfilled from inflection
      expect(loaded.tables.Product?.pluralForm).toBe("Products");
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
      const widget = (saved.tables as Record<string, unknown>).Widget as Record<string, unknown>;
      expect(widget.futurTypeField).toBe("also-keep");
      const idField = (widget.fields as Record<string, unknown>).id as Record<string, unknown>;
      expect(idField.futureFieldProp).toBe(true);
    });
  });

  describe("loadDiff validation", () => {
    test.each([1, 2, 3])("loads supported diff format version %s", (version) => {
      const filePath = path.join(testDir, `v${version}_diff.json`);
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version,
          namespace,
          createdAt: "t",
          changes: [],
          hasBreakingChanges: false,
          breakingChanges: [],
          requiresMigrationScript: false,
        }),
      );

      expect(loadDiff(filePath).version).toBe(version);
    });

    test("rejects diff formats older than the supported window", () => {
      const version = 0;
      const filePath = path.join(testDir, `unsupported_v${version}_diff.json`);
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version,
          namespace,
          createdAt: "t",
          changes: [],
          hasBreakingChanges: false,
          breakingChanges: [],
          requiresMigrationScript: false,
        }),
      );

      expect(() => loadDiff(filePath)).toThrow(/supports migration file format versions 1-5/);
      expect(() => loadDiff(filePath)).toThrow(
        /re-baseline with an SDK that still supports this migration history, then upgrade/i,
      );
    });

    test("rejects diff formats newer than the supported window", () => {
      const version = 6;
      const filePath = path.join(testDir, `unsupported_v${version}_diff.json`);
      fs.writeFileSync(filePath, JSON.stringify({ version }));

      expect(() => loadDiff(filePath)).toThrow(/supports migration file format versions 1-5/);
      expect(() => loadDiff(filePath)).toThrow(
        /upgrade to an SDK that supports migration file format version 6/i,
      );
    });

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

    test("rejects a whitespace-only migration script skip reason", () => {
      const filePath = path.join(testDir, "blank_skip_reason_diff.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: "t",
          changes: [],
          hasBreakingChanges: true,
          breakingChanges: [],
          requiresMigrationScript: true,
          scriptSkipped: { reason: "   ", acknowledgedAt: "2026-07-22T00:00:00.000Z" },
        }),
      );

      expect(() => loadDiff(filePath)).toThrow(/reason/i);
    });
  });

  describe("writeSnapshot", () => {
    test("writes snapshot to directory structure with correct name", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {},
      };

      const filePath = writeSnapshot(snapshot, testDir, INITIAL_SCHEMA_NUMBER);

      expect(filePath).toBe(
        path.join(testDir, formatMigrationNumber(INITIAL_SCHEMA_NUMBER), SCHEMA_FILE_NAME),
      );
      expect(fs.existsSync(filePath)).toBe(true);

      const loaded = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(SCHEMA_SNAPSHOT_VERSION).toBe(5);
      expect(loaded.version).toBe(5);
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

    test("applies type_renamed diff (old type dropped, new type added)", () => {
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

    test("applies added type names that match Object prototype keys", () => {
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
      tableName: string,
      permit: TailorDBGQLPermission_Permit,
      actions: TailorDBGQLPermission_Action[] = [TailorDBGQLPermission_Action.READ],
    ): RemoteGqlPermission {
      return {
        typeName: tableName,
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
      expect(snapshot.tables.Order?.pluralForm).toBe("Orders");
      expect(snapshot.tables.Order?.fields.amount?.scale).toBe(6);
    });

    test("reconstructs remote table-level schema elements", () => {
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

      expect(snapshot.tables.User).toMatchObject({
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

      expect(snapshot.tables.Task?.permissions?.gql).toEqual([
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

      expect(snapshot.tables.User?.fields.email?.validate).toEqual([
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
      expect(Object.hasOwn(remoteSnapshot.tables, "__proto__")).toBe(true);

      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {},
      };

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts).toEqual([
        {
          tableName: "__proto__",
          kind: "type_missing_local",
          details: "Table '__proto__' exists in remote but not in snapshot",
        },
      ]);
    });

    test("returns empty array when remote and snapshot match exactly", () => {
      const snapshot: SchemaSnapshot = {
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

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          name: { type: "string", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts).toEqual([]);
    });

    test("detects remote drift in table-level schema elements", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
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
          expect.objectContaining({ tableName: "User", kind: "type_settings_mismatch" }),
          expect.objectContaining({ tableName: "User", kind: "index_missing_remote" }),
          expect.objectContaining({ tableName: "User", kind: "file_missing_remote" }),
          expect.objectContaining({ tableName: "User", kind: "relationship_missing_remote" }),
          expect.objectContaining({ tableName: "User", kind: "permission_mismatch" }),
        ]),
      );
    });

    test("detects mismatched table-level schema element configs", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
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
          expect.objectContaining({ tableName: "User", kind: "index_mismatch" }),
          expect.objectContaining({ tableName: "User", kind: "file_mismatch" }),
          expect.objectContaining({ tableName: "User", kind: "relationship_mismatch" }),
        ]),
      );
    });

    test("matches explicit GQL operation enable overrides in remote snapshots", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
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
        tables: {
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
          tableName: "User",
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
        tables: {
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
        tables: {
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
      ).toEqual([expect.objectContaining({ tableName: "Task", kind: "permission_mismatch" })]);
    });

    test("ignores permission policy order when comparing remote snapshots", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
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
        tables: {
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
        tables: {
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
      expect(drifts[0]!.tableName).toBe("Post");
    });

    test("detects type missing in snapshot (unexpected type in remote)", () => {
      const snapshot: SchemaSnapshot = {
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
      expect(drifts[0]!.tableName).toBe("ExtraType");
    });

    test("detects field missing in remote", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
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
        tables: {
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
        tables: {
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
        tables: {
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
        tables: {
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
        tables: {
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

    test("reports detailed drift for serial and nested fields", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              metadata: {
                type: "nested",
                required: false,
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
        tables: {
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
        tables: {
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
        tables: {},
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

    test("detects script_mismatch when remote has no hash", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              name: {
                type: "string",
                required: true,
                hooks: { create: { expr: "_value.trim()" } },
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
            name: { type: "string", required: true },
          },
          {
            typeHook: {
              create: { expr: '((_invoker) => { return { "name": _value.trim() }; })()' },
            },
          },
        ),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.some((d) => d.kind === "script_mismatch")).toBe(true);
    });

    test("detects script_mismatch when hashes differ", () => {
      const snapshotFields = {
        name: {
          type: "string",
          required: true,
          hooks: { create: { expr: "_value.trim()" } },
        },
      };
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true }, ...snapshotFields },
          },
        },
      };

      const differentFields = {
        name: {
          type: "string",
          required: true as const,
          hooks: { create: { expr: "_value.toLowerCase()" } },
        },
      };
      const { typeHook } = buildTypeScripts(differentFields);

      const remoteTypes = [
        createMockRemoteType(
          "User",
          { id: { type: "uuid", required: true }, name: { type: "string", required: true } },
          { typeHook },
        ),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.some((d) => d.kind === "script_mismatch")).toBe(true);
    });

    test("reports a conflicting-hash detail (not a missing-hash one) when remote script expressions disagree", () => {
      const snapshotFields = {
        name: {
          type: "string",
          required: true,
          hooks: { create: { expr: "_value.trim()" } },
        },
      };
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true }, ...snapshotFields },
          },
        },
      };

      // Two independent buildTypeScripts calls embed two different hashes;
      // mixing their typeHook and typeValidate outputs simulates a remote
      // type whose script expressions disagree on the hash (e.g. from a
      // partial out-of-band edit), rather than one with no hash at all.
      const { typeHook } = buildTypeScripts(snapshotFields);
      const { typeValidate } = buildTypeScripts(snapshotFields, { typeValidateExpr: "true" });

      const remoteTypes = [
        createMockRemoteType(
          "User",
          { id: { type: "uuid", required: true }, name: { type: "string", required: true } },
          { typeHook, typeValidate },
        ),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      const scriptDrift = drifts.find((d) => d.kind === "script_mismatch");
      expect(scriptDrift?.details).toContain("has conflicting script hashes on remote");
      expect(scriptDrift?.details).not.toContain("has no script hash on remote");
    });

    test("reports a distinct detail (not the missing-hash one) when remote has no scripts at all", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              name: {
                type: "string",
                required: true,
                hooks: { create: { expr: "_value.trim()" } },
              },
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
      const scriptDrift = drifts.find((d) => d.kind === "script_mismatch");
      expect(scriptDrift?.details).toContain("has scripts in snapshot but not on remote");
      expect(scriptDrift?.details).not.toContain("has no script hash on remote");
    });

    test("no script drift when hashes match", () => {
      const snapshotFields = {
        name: {
          type: "string",
          required: true,
          hooks: { create: { expr: "_value.trim()" } },
        },
      };
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true }, ...snapshotFields },
          },
        },
      };

      const { typeHook } = buildTypeScripts(snapshotFields);

      const remoteTypes = [
        createMockRemoteType(
          "User",
          { id: { type: "uuid", required: true }, name: { type: "string", required: true } },
          { typeHook },
        ),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.some((d) => d.kind === "script_mismatch")).toBe(false);
    });

    test("detects script drift when remote has scripts but snapshot does not", () => {
      const snapshot: SchemaSnapshot = {
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

      const remoteTypes = [
        createMockRemoteType(
          "User",
          {
            id: { type: "uuid", required: true },
            name: { type: "string", required: true },
          },
          {
            typeHook: {
              create: { expr: "someExpr() // @sdk-source-hash:abcdef0123456789" },
            },
          },
        ),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.some((d) => d.kind === "script_mismatch")).toBe(true);
    });

    test("no script drift when neither side has scripts", () => {
      const snapshot: SchemaSnapshot = {
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

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          name: { type: "string", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.some((d) => d.kind === "script_mismatch")).toBe(false);
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
          tableName: "User",
          kind: "field_missing_remote" as const,
          fieldName: "email",
          details: "Field 'email' exists in snapshot but not in remote",
        },
        {
          tableName: "User",
          kind: "field_mismatch" as const,
          fieldName: "name",
          details: "type: remote=string, expected=text",
        },
        {
          tableName: "Post",
          kind: "type_missing_remote" as const,
          details: "Table 'Post' exists in snapshot but not in remote",
        },
      ];

      const result = formatSchemaDrifts(drifts);
      expect(result).toContain("Table 'User':");
      expect(result).toContain("Field 'email'");
      expect(result).toContain("Field 'name'");
      expect(result).toContain("Table 'Post':");
    });
  });
});
