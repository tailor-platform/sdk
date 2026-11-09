import { describe, expect, test } from "vitest";
import {
  hasChanges,
  formatMigrationDiff,
  formatBreakingChanges,
  formatWarnings,
  formatDiffSummary,
  SCHEMA_SNAPSHOT_VERSION,
  type MigrationDiff,
  type BreakingChangeInfo,
  type WarningChangeInfo,
} from "./diff-calculator";
import type { TailorDBSnapshotType } from "./snapshot-types";

// Helper to create a minimal snapshot type for type_added / type_removed changes
function snapshotType(name: string): TailorDBSnapshotType {
  return { name, pluralForm: `${name}s`, fields: {} };
}

const referenceField = { type: "uuid", required: true, index: true, foreignKey: true } as const;

// Helper to create a MigrationDiff
function createDiff(
  changes: MigrationDiff["changes"],
  breakingChanges: BreakingChangeInfo[] = [],
): MigrationDiff {
  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: "tailordb",
    createdAt: new Date().toISOString(),
    changes,
    hasBreakingChanges: breakingChanges.length > 0,
    breakingChanges,
    hasWarnings: false,
    warnings: [],
    requiresMigrationScript: breakingChanges.length > 0,
  };
}

describe("diff-calculator", () => {
  describe("hasChanges", () => {
    test("should return false for empty changes", () => {
      expect(hasChanges(createDiff([]))).toBe(false);
    });

    test("should return true when there are changes", () => {
      const diff = createDiff([
        {
          kind: "field_added",
          tableName: "User",
          fieldName: "email",
          after: { type: "string", required: false },
        },
      ]);
      expect(hasChanges(diff)).toBe(true);
    });
  });

  describe("formatMigrationDiff", () => {
    test("should format empty result", () => {
      expect(formatMigrationDiff(createDiff([]))).toBe("No schema differences detected.");
    });

    test.each<{ name: string; changes: MigrationDiff["changes"]; expected: string[] }>([
      {
        name: "added field",
        changes: [
          {
            kind: "field_added",
            tableName: "User",
            fieldName: "email",
            after: { type: "string", required: false },
          },
        ],
        expected: ["tailordb.User:", "+ email: string (optional)"],
      },
      {
        name: "added required field",
        changes: [
          {
            kind: "field_added",
            tableName: "User",
            fieldName: "email",
            after: { type: "string", required: true },
          },
        ],
        expected: ["+ email: string (required)"],
      },
      {
        name: "removed field",
        changes: [
          {
            kind: "field_removed",
            tableName: "User",
            fieldName: "email",
            before: { type: "string", required: true },
          },
        ],
        expected: ["- email: string"],
      },
      {
        name: "modified field",
        changes: [
          {
            kind: "field_modified",
            tableName: "User",
            fieldName: "email",
            before: { type: "string", required: false },
            after: { type: "string", required: true },
          },
        ],
        expected: ["~ email: required: false → true"],
      },
      {
        name: "modified field type",
        changes: [
          {
            kind: "field_type_modified",
            tableName: "User",
            fieldName: "age",
            before: { type: "integer", required: false },
            after: { type: "float", required: false },
          },
        ],
        expected: ["~ age: type: integer → float"],
      },
      {
        name: "modified nested members",
        changes: [
          {
            kind: "field_modified",
            tableName: "User",
            fieldName: "address",
            before: {
              type: "nested",
              required: false,
              fields: {
                zip: { type: "string", required: false },
                geo: {
                  type: "nested",
                  required: false,
                  fields: { lat: { type: "string", required: false } },
                },
              },
            },
            after: {
              type: "nested",
              required: false,
              fields: {
                zipCode: { type: "string", required: false },
                geo: {
                  type: "nested",
                  required: false,
                  fields: { lat: { type: "string", required: true } },
                },
              },
            },
          },
        ],
        expected: ["~ address: members: -zip, +zipCode, ~geo.lat (required: false → true)"],
      },
      {
        name: "renamed nested members",
        changes: [
          {
            kind: "field_modified",
            tableName: "User",
            fieldName: "address",
            before: {
              type: "nested",
              required: false,
              fields: {
                zip: { type: "string", required: false },
                fax: { type: "string", required: false },
              },
            },
            after: {
              type: "nested",
              required: false,
              fields: { zipCode: { type: "string", required: false } },
            },
            memberRenames: [{ previousPath: ["zip"], path: ["zipCode"] }],
          },
        ],
        expected: ["~ address: members: -fax, zip → zipCode (renamed)"],
      },
      {
        name: "foreign keys on nested members",
        changes: [
          {
            kind: "field_modified",
            tableName: "Post",
            fieldName: "address",
            before: {
              type: "nested",
              required: false,
              fields: {
                ownerId: { ...referenceField, foreignKeyType: "User", foreignKeyField: "id" },
                managerId: { type: "uuid", required: true },
                reviewerId: { ...referenceField, foreignKeyType: "User", foreignKeyField: "id" },
              },
            },
            after: {
              type: "nested",
              required: false,
              fields: {
                ownerId: { ...referenceField, foreignKeyType: "Person", foreignKeyField: "id" },
                managerId: { ...referenceField, foreignKeyType: "User", foreignKeyField: "id" },
                reviewerId: { type: "uuid", required: true, index: true },
              },
            },
          },
        ],
        expected: [
          "~ address: members: ~ownerId (foreignKey: User.id → Person.id), ~managerId (index: false → true, foreignKey: none → User.id), ~reviewerId (foreignKey: User.id → none)",
        ],
      },
      {
        name: "nested member without a rendered detail",
        changes: [
          {
            kind: "field_modified",
            tableName: "User",
            fieldName: "address",
            before: {
              type: "nested",
              required: false,
              fields: { zip: { type: "string", required: false } },
            },
            after: {
              type: "nested",
              required: false,
              fields: { zip: { type: "string", required: false, description: "Postal code" } },
            },
          },
        ],
        expected: ["~ address: members: ~zip"],
      },
      {
        name: "added foreign key",
        changes: [
          {
            kind: "field_modified",
            tableName: "Post",
            fieldName: "ownerId",
            before: { type: "uuid", required: true },
            after: {
              type: "uuid",
              required: true,
              index: true,
              foreignKey: true,
              foreignKeyType: "User",
              foreignKeyField: "id",
            },
          },
        ],
        expected: ["~ ownerId: index: false → true, foreignKey: none → User.id"],
      },
      {
        name: "retargeted foreign key",
        changes: [
          {
            kind: "field_modified",
            tableName: "Post",
            fieldName: "ownerId",
            before: { ...referenceField, foreignKeyType: "User", foreignKeyField: "id" },
            after: { ...referenceField, foreignKeyType: "Person", foreignKeyField: "id" },
          },
        ],
        expected: ["~ ownerId: foreignKey: User.id → Person.id"],
      },
      {
        name: "foreign key moved to another key",
        changes: [
          {
            kind: "field_modified",
            tableName: "Post",
            fieldName: "ownerId",
            before: { ...referenceField, foreignKeyType: "User" },
            after: { ...referenceField, foreignKeyType: "User", foreignKeyField: "email" },
          },
        ],
        expected: ["~ ownerId: foreignKey: User.id → User.email"],
      },
      {
        name: "removed foreign key",
        changes: [
          {
            kind: "field_modified",
            tableName: "Post",
            fieldName: "ownerId",
            before: { ...referenceField, foreignKeyType: "User", foreignKeyField: "id" },
            after: { type: "uuid", required: true, index: true },
          },
        ],
        expected: ["~ ownerId: foreignKey: User.id → none"],
      },
      {
        name: "field filled on create",
        changes: [
          {
            kind: "field_modified",
            tableName: "User",
            fieldName: "status",
            before: { type: "string", required: true },
            after: { type: "string", required: true, optionalOnCreate: true },
          },
        ],
        expected: ["~ status: optionalOnCreate: false → true"],
      },
      {
        name: "modified field without a rendered detail",
        changes: [
          {
            kind: "field_modified",
            tableName: "User",
            fieldName: "email",
            before: { type: "string", required: false },
            after: { type: "string", required: false, description: "Primary email" },
          },
        ],
        expected: ["~ email: configuration changed"],
      },
      {
        name: "type addition",
        changes: [{ kind: "table_added", tableName: "NewType", after: snapshotType("NewType") }],
        expected: ["+ [Table] NewType (new table)"],
      },
      {
        name: "type removal",
        changes: [{ kind: "table_removed", tableName: "OldType", before: snapshotType("OldType") }],
        expected: ["- [Table] OldType (removed)"],
      },
      {
        name: "array field",
        changes: [
          {
            kind: "field_added",
            tableName: "User",
            fieldName: "tags",
            after: { type: "string", required: false, array: true },
          },
        ],
        expected: ["+ tags: string[] (optional)"],
      },
      {
        name: "changes grouped by type",
        changes: [
          {
            kind: "field_added",
            tableName: "User",
            fieldName: "email",
            after: { type: "string", required: false },
          },
          {
            kind: "field_added",
            tableName: "User",
            fieldName: "phone",
            after: { type: "string", required: false },
          },
          {
            kind: "field_added",
            tableName: "Product",
            fieldName: "price",
            after: { type: "number", required: true },
          },
        ],
        expected: ["tailordb.User:", "tailordb.Product:"],
      },
    ])("should format $name", ({ changes, expected }) => {
      const lines = formatMigrationDiff(createDiff(changes))
        .split("\n")
        .map((line) => line.trim());
      expect(lines).toEqual(expect.arrayContaining(expected));
    });
  });

  describe("formatBreakingChanges", () => {
    test("should return empty string for no breaking changes", () => {
      expect(formatBreakingChanges([])).toBe("");
    });

    test("should format breaking changes with field", () => {
      const breakingChanges: BreakingChangeInfo[] = [
        { tableName: "User", fieldName: "email", reason: "Required field added" },
      ];
      const result = formatBreakingChanges(breakingChanges);
      expect(result).toContain("Breaking changes detected:");
      expect(result).toContain("User.email: Required field added");
    });

    test("should format breaking changes without field (table-level)", () => {
      const breakingChanges: BreakingChangeInfo[] = [
        { tableName: "OldType", reason: "Type removed" },
      ];
      expect(formatBreakingChanges(breakingChanges)).toContain("OldType: Type removed");
    });

    test("should format multiple breaking changes", () => {
      const breakingChanges: BreakingChangeInfo[] = [
        { tableName: "User", fieldName: "email", reason: "Field removed" },
        { tableName: "Product", fieldName: "price", reason: "Type changed" },
      ];
      const result = formatBreakingChanges(breakingChanges);
      expect(result).toContain("User.email: Field removed");
      expect(result).toContain("Product.price: Type changed");
    });
  });

  describe("formatWarnings", () => {
    test("should return empty string for no warnings", () => {
      expect(formatWarnings([])).toBe("");
    });

    test("should format warnings with field", () => {
      const warnings: WarningChangeInfo[] = [
        {
          tableName: "User",
          fieldName: "legacyId",
          reason: "Field removed (existing data will no longer be accessible through the schema)",
        },
      ];
      const result = formatWarnings(warnings);
      expect(result).toContain("Warning: data loss possible:");
      expect(result).toContain(
        "User.legacyId: Field removed (existing data will no longer be accessible through the schema)",
      );
    });

    test("should format warnings without field (table-level)", () => {
      const warnings: WarningChangeInfo[] = [
        {
          tableName: "OldType",
          reason:
            "Table removed (all records in this table will be deleted during post-migration cleanup)",
        },
      ];
      expect(formatWarnings(warnings)).toContain(
        "OldType: Table removed (all records in this table will be deleted during post-migration cleanup)",
      );
    });

    test("should format multiple warnings", () => {
      const warnings: WarningChangeInfo[] = [
        { tableName: "User", fieldName: "legacyId", reason: "Field removed" },
        { tableName: "OldType", reason: "Type removed" },
      ];
      const result = formatWarnings(warnings);
      expect(result).toContain("User.legacyId: Field removed");
      expect(result).toContain("OldType: Type removed");
    });
  });

  describe("formatDiffSummary", () => {
    test("should return 'No changes' for empty diff", () => {
      expect(formatDiffSummary(createDiff([]))).toBe("No changes");
    });

    test.each<{ name: string; changes: MigrationDiff["changes"]; expected: string[] }>([
      {
        name: "tables added",
        changes: [
          { kind: "table_added", tableName: "NewType1", after: snapshotType("NewType1") },
          { kind: "table_added", tableName: "NewType2", after: snapshotType("NewType2") },
        ],
        expected: ["2 table(s) added"],
      },
      {
        name: "tables removed",
        changes: [{ kind: "table_removed", tableName: "OldType", before: snapshotType("OldType") }],
        expected: ["1 table(s) removed"],
      },
      {
        name: "fields added",
        changes: [
          {
            kind: "field_added",
            tableName: "User",
            fieldName: "email",
            after: { type: "string", required: false },
          },
        ],
        expected: ["1 field(s) added"],
      },
      {
        name: "fields removed",
        changes: [
          {
            kind: "field_removed",
            tableName: "User",
            fieldName: "oldField",
            before: { type: "string", required: false },
          },
        ],
        expected: ["1 field(s) removed"],
      },
      {
        name: "fields modified",
        changes: [
          {
            kind: "field_modified",
            tableName: "User",
            fieldName: "email",
            before: { type: "string", required: false },
            after: { type: "string", required: true },
          },
        ],
        expected: ["1 field(s) modified"],
      },
      {
        name: "field types modified",
        changes: [
          {
            kind: "field_type_modified",
            tableName: "User",
            fieldName: "age",
            before: { type: "integer", required: false },
            after: { type: "float", required: false },
          },
        ],
        expected: ["1 field type(s) modified"],
      },
      {
        name: "multiple counts",
        changes: [
          { kind: "table_added", tableName: "NewType", after: snapshotType("NewType") },
          {
            kind: "field_added",
            tableName: "User",
            fieldName: "email",
            after: { type: "string", required: false },
          },
          {
            kind: "field_removed",
            tableName: "User",
            fieldName: "oldField",
            before: { type: "string", required: false },
          },
        ],
        expected: ["1 table(s) added", "1 field(s) added", "1 field(s) removed"],
      },
    ])("should count $name", ({ changes, expected }) => {
      const result = formatDiffSummary(createDiff(changes));
      for (const substring of expected) {
        expect(result).toContain(substring);
      }
    });
  });
});
