import { describe, expect, test } from "vitest";
import { supportsInPlaceFieldTypeChange } from "./field-type-change";
import type { SnapshotFieldConfig } from "./snapshot-types";

function field(type: string, overrides: Partial<SnapshotFieldConfig> = {}): SnapshotFieldConfig {
  return { type, required: false, ...overrides };
}

describe("supportsInPlaceFieldTypeChange", () => {
  test.each([
    ["uuid", "string"],
    ["enum", "string"],
    ["decimal", "string"],
    ["integer", "float"],
  ])("allows %s to %s", (before, after) => {
    expect(supportsInPlaceFieldTypeChange(field(before), field(after))).toBe(true);
  });

  test.each([
    ["string", "integer"],
    ["integer", "boolean"],
    ["boolean", "integer"],
    ["float", "integer"],
    ["date", "string"],
  ])("rejects unverified %s to %s", (before, after) => {
    expect(supportsInPlaceFieldTypeChange(field(before), field(after))).toBe(false);
  });

  test.each([
    ["arrays", { array: true }],
    ["serial fields", { serial: { start: 1 } }],
    ["vector fields", { vector: true }],
    ["foreign keys", { foreignKey: true }],
  ] satisfies [string, Partial<SnapshotFieldConfig>][])("rejects $0", (_name, overrides) => {
    expect(supportsInPlaceFieldTypeChange(field("integer", overrides), field("float"))).toBe(false);
  });
});
