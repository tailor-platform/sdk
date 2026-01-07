import { describe, expect, it } from "vitest";
import {
  hasChanges,
  formatMigrationDiff,
  formatBreakingChanges,
  formatDiffSummary,
} from "./diff-calculator";
import { SCHEMA_SNAPSHOT_VERSION } from "./types";
import type { MigrationDiff, BreakingChangeInfo } from "./types";

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
    requiresMigrationScript: breakingChanges.length > 0,
  };
}

describe("diff-calculator", () => {
  describe("hasChanges", () => {
    it("should return false for empty changes", () => {
      const diff = createDiff([]);
      expect(hasChanges(diff)).toBe(false);
    });

    it("should return true when there are changes", () => {
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
    it("should format empty result", () => {
      const diff = createDiff([]);
      const result = formatMigrationDiff(diff);
      expect(result).toBe("No schema differences detected.");
    });

    it("should format added field", () => {
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

    it("should format added required field", () => {
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

    it("should format removed field", () => {
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

    it("should format modified field", () => {
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

    it("should format type addition", () => {
      const diff = createDiff([
        {
          kind: "type_added",
          typeName: "NewType",
        },
      ]);
      const result = formatMigrationDiff(diff);
      expect(result).toContain("+ [Type] NewType (new type)");
    });

    it("should format type removal", () => {
      const diff = createDiff([
        {
          kind: "type_removed",
          typeName: "OldType",
        },
      ]);
      const result = formatMigrationDiff(diff);
      expect(result).toContain("- [Type] OldType (removed)");
    });

    it("should format array field", () => {
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

    it("should group changes by type", () => {
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
    it("should return empty string for no breaking changes", () => {
      const result = formatBreakingChanges([]);
      expect(result).toBe("");
    });

    it("should format breaking changes with field", () => {
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

    it("should format breaking changes without field (type-level)", () => {
      const breakingChanges: BreakingChangeInfo[] = [
        {
          typeName: "OldType",
          reason: "Type removed",
        },
      ];
      const result = formatBreakingChanges(breakingChanges);
      expect(result).toContain("OldType: Type removed");
    });

    it("should format multiple breaking changes", () => {
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

  describe("formatDiffSummary", () => {
    it("should return 'No changes' for empty diff", () => {
      const diff = createDiff([]);
      const result = formatDiffSummary(diff);
      expect(result).toBe("No changes");
    });

    it("should count types added", () => {
      const diff = createDiff([
        { kind: "type_added", typeName: "NewType1" },
        { kind: "type_added", typeName: "NewType2" },
      ]);
      const result = formatDiffSummary(diff);
      expect(result).toContain("2 type(s) added");
    });

    it("should count types removed", () => {
      const diff = createDiff([{ kind: "type_removed", typeName: "OldType" }]);
      const result = formatDiffSummary(diff);
      expect(result).toContain("1 type(s) removed");
    });

    it("should count fields added", () => {
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

    it("should count fields removed", () => {
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

    it("should count fields modified", () => {
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

    it("should combine multiple counts", () => {
      const diff = createDiff([
        { kind: "type_added", typeName: "NewType" },
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
