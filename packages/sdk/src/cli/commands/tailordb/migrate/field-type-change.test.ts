import { describe, expect, test } from "vitest";
import { supportsInPlaceFieldTypeChange } from "./field-type-change";
import { snapshotField } from "./test-helpers/schema-fixtures";
import type { SnapshotFieldConfig } from "./snapshot-types";

describe("supportsInPlaceFieldTypeChange", () => {
  test.each([
    ["uuid", "string"],
    ["enum", "string"],
    ["decimal", "string"],
    ["integer", "float"],
  ])("allows %s to %s", (before, after) => {
    expect(supportsInPlaceFieldTypeChange(snapshotField(before), snapshotField(after))).toBe(true);
  });

  test.each([
    ["string", "integer"],
    ["integer", "boolean"],
    ["boolean", "integer"],
    ["float", "integer"],
    ["date", "string"],
  ])("rejects unverified %s to %s", (before, after) => {
    expect(supportsInPlaceFieldTypeChange(snapshotField(before), snapshotField(after))).toBe(false);
  });

  test.each([
    ["arrays", { array: true }],
    ["serial fields", { serial: { start: 1 } }],
    ["vector fields", { vector: true }],
    ["foreign keys", { foreignKey: true }],
  ] satisfies [string, Partial<SnapshotFieldConfig>][])("rejects $0", (_name, overrides) => {
    expect(
      supportsInPlaceFieldTypeChange(snapshotField("integer", overrides), snapshotField("float")),
    ).toBe(false);
  });
});
