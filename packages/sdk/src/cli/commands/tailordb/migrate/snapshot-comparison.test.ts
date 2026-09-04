import { describe, expect, test } from "vitest";
import {
  createSnapshotFromLocalTypes,
  compareLocalTypesWithSnapshot,
  SCHEMA_SNAPSHOT_VERSION,
  type SchemaSnapshot,
} from "./snapshot";
import { compareRawSnapshots, createMockType } from "./test-helpers/snapshot-test";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { RelationshipAddedChange } from "./diff-calculator";
import type { SnapshotFieldConfig } from "./snapshot-types";

describe("snapshot", () => {
  const namespace = "tailordb";

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

    test("detects table addition", () => {
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

    describe("nested member changes", () => {
      const NESTED_MEMBER_REMOVED =
        "Nested member removed (existing values will no longer be accessible through the schema)";
      const userWithAddress = (
        address: Record<string, SnapshotFieldConfig>,
        overrides: Partial<SnapshotFieldConfig> = {},
      ): SchemaSnapshot => ({
        ...createEmptySnapshot(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              address: { type: "nested", required: false, fields: address, ...overrides },
            },
          },
        },
      });
      const str: SnapshotFieldConfig = { type: "string", required: false };

      test("warns when a nested member is removed", () => {
        const diff = compareRawSnapshots(
          userWithAddress({ city: str, zip: str }),
          userWithAddress({ city: str }),
        );

        expect(diff.changes.map((c) => c.kind)).toEqual(["field_modified"]);
        expect(diff.hasBreakingChanges).toBe(false);
        expect(diff.requiresMigrationScript).toBe(false);
        expect(diff.hasWarnings).toBe(true);
        expect(diff.warnings).toEqual([
          { tableName: "User", fieldName: "address.zip", reason: NESTED_MEMBER_REMOVED },
        ]);
      });

      test("names a compatible added member as a possible rename target", () => {
        const diff = compareRawSnapshots(
          userWithAddress({ zip: str }),
          userWithAddress({ zipCode: str }),
        );

        expect(diff.changes.map((c) => c.kind)).toEqual(["field_modified"]);
        expect(diff.warnings).toHaveLength(1);
        expect(diff.warnings[0]!.fieldName).toBe("address.zip");
        expect(diff.warnings[0]!.reason).toBe(
          `${NESTED_MEMBER_REMOVED}. Possibly renamed to zipCode: nested renames are not detected, ` +
            "so keep the old member until a migration script has copied its values and remove it in a later migration",
        );
      });

      test("lists every compatible added member in the rename hint", () => {
        const diff = compareRawSnapshots(
          userWithAddress({ zip: str }),
          userWithAddress({ zipCode: str, postalCode: str }),
        );

        expect(diff.warnings[0]!.reason).toContain("Possibly renamed to zipCode, postalCode:");
      });

      test("does not suggest a compatible member added at a different level", () => {
        const diff = compareRawSnapshots(
          userWithAddress({ zip: str, geo: { type: "nested", required: false, fields: {} } }),
          userWithAddress({ geo: { type: "nested", required: false, fields: { zip: str } } }),
        );

        expect(diff.warnings).toEqual([
          { tableName: "User", fieldName: "address.zip", reason: NESTED_MEMBER_REMOVED },
        ]);
      });

      test("does not suggest a rename when the added member's requiredness differs", () => {
        const diff = compareRawSnapshots(
          userWithAddress({ zip: str }),
          userWithAddress({ zipCode: { type: "string", required: true } }),
        );

        expect(diff.warnings).toEqual([
          { tableName: "User", fieldName: "address.zip", reason: NESTED_MEMBER_REMOVED },
        ]);
      });

      test("does not suggest a rename when the added member's type differs", () => {
        const diff = compareRawSnapshots(
          userWithAddress({ zip: str }),
          userWithAddress({ zipCode: { type: "integer", required: false } }),
        );

        expect(diff.warnings[0]!.reason).toBe(NESTED_MEMBER_REMOVED);
      });

      test("reports the full member path for a deeply nested removal", () => {
        const diff = compareRawSnapshots(
          userWithAddress({
            geo: { type: "nested", required: false, fields: { lat: str, lng: str } },
          }),
          userWithAddress({ geo: { type: "nested", required: false, fields: { lat: str } } }),
        );

        expect(diff.warnings).toEqual([
          { tableName: "User", fieldName: "address.geo.lng", reason: NESTED_MEMBER_REMOVED },
        ]);
      });

      test("warns once for a removed member that is itself nested", () => {
        const diff = compareRawSnapshots(
          userWithAddress({
            geo: { type: "nested", required: false, fields: { lat: str, lng: str } },
          }),
          userWithAddress({}),
        );

        expect(diff.warnings).toEqual([
          { tableName: "User", fieldName: "address.geo", reason: NESTED_MEMBER_REMOVED },
        ]);
      });

      test("keeps the warning when the same field also has a breaking change", () => {
        const diff = compareRawSnapshots(
          userWithAddress({ zip: str }),
          userWithAddress({}, { required: true }),
        );

        expect(diff.hasBreakingChanges).toBe(true);
        expect(diff.breakingChanges.map((b) => b.reason)).toEqual([
          "Field changed from optional to required",
        ]);
        expect(diff.warnings).toEqual([
          { tableName: "User", fieldName: "address.zip", reason: NESTED_MEMBER_REMOVED },
        ]);
      });

      test("does not warn when a nested member is only added", () => {
        const diff = compareRawSnapshots(
          userWithAddress({ city: str }),
          userWithAddress({ city: str, zip: str }),
        );

        expect(diff.changes.map((c) => c.kind)).toEqual(["field_modified"]);
        expect(diff.hasWarnings).toBe(false);
        expect(diff.warnings).toEqual([]);
      });

      test("does not emit nested warnings when the field's own type changes", () => {
        const current: SchemaSnapshot = {
          ...createEmptySnapshot(),
          tables: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: {
                id: { type: "uuid", required: true },
                address: { type: "string", required: false },
              },
            },
          },
        };
        const diff = compareRawSnapshots(userWithAddress({ zip: str }), current);

        expect(diff.changes.map((c) => c.kind)).toEqual(["field_type_modified"]);
        expect(diff.hasBreakingChanges).toBe(true);
        expect(diff.warnings).toEqual([]);
      });
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

    describe("table renames", () => {
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

      test("rejects a rename between incompatible table shapes", () => {
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
    test("compares local tables with existing snapshot", () => {
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
});
