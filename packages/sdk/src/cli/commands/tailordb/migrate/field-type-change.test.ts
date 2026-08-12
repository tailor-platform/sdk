import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { IN_PLACE_TYPE_CHANGES, supportsInPlaceFieldTypeChange } from "./field-type-change";
import type { SnapshotFieldConfig } from "./snapshot-types";

const MIGRATION_DOC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../docs/services/tailordb-migration.md",
);

function field(type: string, overrides: Partial<SnapshotFieldConfig> = {}): SnapshotFieldConfig {
  return { type, required: false, ...overrides };
}

/**
 * Read the documented in-place pairs out of the "Field type changes" table.
 * @returns Documented pairs as `from:to` keys
 */
function documentedPairs(): Set<string> {
  const doc = fs.readFileSync(MIGRATION_DOC, "utf-8");
  const section = doc.split("### Field type changes")[1];
  if (!section) throw new Error("Field type changes section not found");
  const table = section.split("\n\n").find((block) => block.startsWith("| From"));
  if (!table) throw new Error("Field type changes table not found");

  const pairs = new Set<string>();
  for (const line of table.split("\n").slice(2)) {
    const cells = line.split("|").map((cell) => cell.trim());
    const from = cells[1]?.replaceAll("`", "");
    if (!from) continue;
    for (const to of (cells[2] ?? "").split(",")) {
      const target = to.trim().replaceAll("`", "");
      if (target) pairs.add(`${from}:${target}`);
    }
  }
  return pairs;
}

describe("supportsInPlaceFieldTypeChange", () => {
  test.each([
    ["uuid", "string"],
    ["enum", "string"],
    ["decimal", "string"],
    ["integer", "float"],
    ["integer", "string"],
    ["float", "string"],
    ["boolean", "string"],
    ["integer", "decimal"],
    ["float", "decimal"],
    ["decimal", "float"],
  ])("allows %s to %s", (before, after) => {
    expect(supportsInPlaceFieldTypeChange(field(before), field(after))).toBe(true);
  });

  test.each([
    ["boolean", "integer"],
    ["float", "integer"],
    ["string", "date"],
  ])("rejects %s to %s, which the platform refuses to cast", (before, after) => {
    expect(supportsInPlaceFieldTypeChange(field(before), field(after))).toBe(false);
  });

  test.each([
    ["string", "integer"],
    ["string", "float"],
    ["string", "boolean"],
    ["string", "uuid"],
    ["string", "decimal"],
    ["integer", "boolean"],
  ])("rejects %s to %s, whose source domain does not fully cast", (before, after) => {
    expect(supportsInPlaceFieldTypeChange(field(before), field(after))).toBe(false);
  });

  test.each([
    ["date", "string"],
    ["datetime", "string"],
    ["time", "string"],
    ["date", "datetime"],
  ])("rejects %s to %s, which deploys but changes the stored instant", (before, after) => {
    expect(supportsInPlaceFieldTypeChange(field(before), field(after))).toBe(false);
  });

  test("matches the pairs documented in the migration guide", () => {
    expect([...documentedPairs()].toSorted()).toEqual([...IN_PLACE_TYPE_CHANGES].toSorted());
  });

  test.each([
    ["arrays", { array: true }],
    ["serial fields", { serial: { start: 1 } }],
    ["vector fields", { vector: true }],
    ["foreign keys", { foreignKey: true }],
  ] satisfies [string, Partial<SnapshotFieldConfig>][])("rejects $0", (_name, overrides) => {
    expect(supportsInPlaceFieldTypeChange(field("integer", overrides), field("float"))).toBe(false);
  });

  describe("already-unique fields whose values can collapse", () => {
    // Every pair here is otherwise allowed, so only the unique guard can reject it.
    test.each([["float", "decimal"]])("rejects unique %s to %s", (before, after) => {
      expect(supportsInPlaceFieldTypeChange(field(before), field(after))).toBe(true);
      expect(supportsInPlaceFieldTypeChange(field(before, { unique: true }), field(after))).toBe(
        false,
      );
    });

    test("rejects a unique float narrowing to a scaled decimal", () => {
      expect(
        supportsInPlaceFieldTypeChange(
          field("float", { unique: true }),
          field("decimal", { scale: 2 }),
        ),
      ).toBe(false);
    });

    test.each([
      ["integer", "string"],
      ["integer", "decimal"],
      ["decimal", "string"],
      ["integer", "float"],
      ["decimal", "float"],
    ])("allows unique %s to %s, which keeps values distinct", (before, after) => {
      expect(supportsInPlaceFieldTypeChange(field(before, { unique: true }), field(after))).toBe(
        true,
      );
    });
  });
});
