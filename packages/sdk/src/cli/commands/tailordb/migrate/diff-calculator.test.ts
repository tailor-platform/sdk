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
      const diff = createDiff([]);
      expect(hasChanges(diff)).toBe(false);
    });

    test("should return true when there are changes", () => {
      const diff = createDiff([
        {
          kind: "field_added",
          typeName: "User",
          fieldName: "email",
          after: { type: "string", required: false },
        },
      ]);
      expect(hasChanges(diff)).toBe(true);
    });
  });

  describe("formatMigrationDiff", () => {
    test("should format empty result", () => {
      const diff = createDiff([]);
      const result = formatMigrationDiff(diff);
      expect(result).toBe("No schema differences detected.");
    });

    test("should format added field", () => {
      const diff = createDiff([
        {
          kind: "field_added",
          typeName: "User",
          fieldName: "email",
          after: { type: "string", required: false },
        },
      ]);
      const result = formatMigrationDiff(diff);
      expect(result).toContain("tailordb.User:");
      expect(result).toContain("+ email: string (optional)");
    });

    test("should format added required field", () => {
      const diff = createDiff([
        {
          kind: "field_added",
          typeName: "User",
          fieldName: "email",
          after: { type: "string", required: true },
        },
      ]);
      const result = formatMigrationDiff(diff);
      expect(result).toContain("+ email: string (required)");
    });

    test("should format removed field", () => {
      const diff = createDiff([
        {
          kind: "field_removed",
          typeName: "User",
          fieldName: "email",
          before: { type: "string", required: true },
        },
      ]);
      const result = formatMigrationDiff(diff);
      expect(result).toContain("- email: string");
    });

    test("should format modified field", () => {
      const diff = createDiff([
        {
          kind: "field_modified",
          typeName: "User",
          fieldName: "email",
          before: { type: "string", required: false },
          after: { type: "string", required: true },
        },
      ]);
      const result = formatMigrationDiff(diff);
      expect(result).toContain("~ email: required: false → true");
    });

    test("should format type addition", () => {
      const diff = createDiff([
        {
          kind: "type_added",
          typeName: "NewType",
          after: snapshotType("NewType"),
        },
      ]);
      const result = formatMigrationDiff(diff);
      expect(result).toContain("+ [Type] NewType (new type)");
    });

    test("should format type removal", () => {
      const diff = createDiff([
        {
          kind: "type_removed",
          typeName: "OldType",
          before: snapshotType("OldType"),
        },
      ]);
      const result = formatMigrationDiff(diff);
      expect(result).toContain("- [Type] OldType (removed)");
    });

    test("should format array field", () => {
      const diff = createDiff([
        {
          kind: "field_added",
          typeName: "User",
          fieldName: "tags",
          after: { type: "string", required: false, array: true },
        },
      ]);
      const result = formatMigrationDiff(diff);
      expect(result).toContain("+ tags: string[] (optional)");
    });

    test("should group changes by type", () => {
      const diff = createDiff([
        {
          kind: "field_added",
          typeName: "User",
          fieldName: "email",
          after: { type: "string", required: false },
        },
        {
          kind: "field_added",
          typeName: "User",
          fieldName: "phone",
          after: { type: "string", required: false },
        },
        {
          kind: "field_added",
          typeName: "Product",
          fieldName: "price",
          after: { type: "number", required: true },
        },
      ]);
      const result = formatMigrationDiff(diff);
      expect(result).toContain("tailordb.User:");
      expect(result).toContain("tailordb.Product:");
    });
  });

  describe("formatBreakingChanges", () => {
    test("should return empty string for no breaking changes", () => {
      const result = formatBreakingChanges([]);
      expect(result).toBe("");
    });

    test("should format breaking changes with field", () => {
      const breakingChanges: BreakingChangeInfo[] = [
        {
          typeName: "User",
          fieldName: "email",
          reason: "Required field added",
        },
      ];
      const result = formatBreakingChanges(breakingChanges);
      expect(result).toContain("Breaking changes detected:");
      expect(result).toContain("User.email: Required field added");
    });

    test("should format breaking changes without field (type-level)", () => {
      const breakingChanges: BreakingChangeInfo[] = [
        {
          typeName: "OldType",
          reason: "Type removed",
        },
      ];
      const result = formatBreakingChanges(breakingChanges);
      expect(result).toContain("OldType: Type removed");
    });

    test("should format multiple breaking changes", () => {
      const breakingChanges: BreakingChangeInfo[] = [
        {
          typeName: "User",
          fieldName: "email",
          reason: "Field removed",
        },
        {
          typeName: "Product",
          fieldName: "price",
          reason: "Type changed",
        },
      ];
      const result = formatBreakingChanges(breakingChanges);
      expect(result).toContain("User.email: Field removed");
      expect(result).toContain("Product.price: Type changed");
    });
  });

  describe("formatWarnings", () => {
    test("should return empty string for no warnings", () => {
      const result = formatWarnings([]);
      expect(result).toBe("");
    });

    test("should format warnings with field", () => {
      const warnings: WarningChangeInfo[] = [
        {
          typeName: "User",
          fieldName: "legacyId",
          reason: "Field removed (existing data will be dropped in the post-migration phase)",
        },
      ];
      const result = formatWarnings(warnings);
      expect(result).toContain("Warning: data loss possible:");
      expect(result).toContain(
        "User.legacyId: Field removed (existing data will be dropped in the post-migration phase)",
      );
    });

    test("should format warnings without field (type-level)", () => {
      const warnings: WarningChangeInfo[] = [
        {
          typeName: "OldType",
          reason:
            "Type removed (all records of this type will be dropped in the post-migration phase)",
        },
      ];
      const result = formatWarnings(warnings);
      expect(result).toContain(
        "OldType: Type removed (all records of this type will be dropped in the post-migration phase)",
      );
    });

    test("should format multiple warnings", () => {
      const warnings: WarningChangeInfo[] = [
        { typeName: "User", fieldName: "legacyId", reason: "Field removed" },
        { typeName: "OldType", reason: "Type removed" },
      ];
      const result = formatWarnings(warnings);
      expect(result).toContain("User.legacyId: Field removed");
      expect(result).toContain("OldType: Type removed");
    });
  });

  describe("formatDiffSummary", () => {
    test("should return 'No changes' for empty diff", () => {
      const diff = createDiff([]);
      const result = formatDiffSummary(diff);
      expect(result).toBe("No changes");
    });

    test("should count types added", () => {
      const diff = createDiff([
        { kind: "type_added", typeName: "NewType1", after: snapshotType("NewType1") },
        { kind: "type_added", typeName: "NewType2", after: snapshotType("NewType2") },
      ]);
      const result = formatDiffSummary(diff);
      expect(result).toContain("2 type(s) added");
    });

    test("should count types removed", () => {
      const diff = createDiff([
        { kind: "type_removed", typeName: "OldType", before: snapshotType("OldType") },
      ]);
      const result = formatDiffSummary(diff);
      expect(result).toContain("1 type(s) removed");
    });

    test("should count fields added", () => {
      const diff = createDiff([
        {
          kind: "field_added",
          typeName: "User",
          fieldName: "email",
          after: { type: "string", required: false },
        },
      ]);
      const result = formatDiffSummary(diff);
      expect(result).toContain("1 field(s) added");
    });

    test("should count fields removed", () => {
      const diff = createDiff([
        {
          kind: "field_removed",
          typeName: "User",
          fieldName: "oldField",
          before: { type: "string", required: false },
        },
      ]);
      const result = formatDiffSummary(diff);
      expect(result).toContain("1 field(s) removed");
    });

    test("should count fields modified", () => {
      const diff = createDiff([
        {
          kind: "field_modified",
          typeName: "User",
          fieldName: "email",
          before: { type: "string", required: false },
          after: { type: "string", required: true },
        },
      ]);
      const result = formatDiffSummary(diff);
      expect(result).toContain("1 field(s) modified");
    });

    test("should combine multiple counts", () => {
      const diff = createDiff([
        { kind: "type_added", typeName: "NewType", after: snapshotType("NewType") },
        {
          kind: "field_added",
          typeName: "User",
          fieldName: "email",
          after: { type: "string", required: false },
        },
        {
          kind: "field_removed",
          typeName: "User",
          fieldName: "oldField",
          before: { type: "string", required: false },
        },
      ]);
      const result = formatDiffSummary(diff);
      expect(result).toContain("1 type(s) added");
      expect(result).toContain("1 field(s) added");
      expect(result).toContain("1 field(s) removed");
    });
  });
});
