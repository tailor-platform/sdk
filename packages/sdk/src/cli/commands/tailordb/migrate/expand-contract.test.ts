import { describe, expect, test } from "vitest";
import { buildTempFieldName, planExpandContract } from "./expand-contract";
import { createMockMigrationDiff } from "./test-helpers/migration-diff";
import { snapshotType } from "./test-helpers/schema-fixtures";
import type { DiffChange } from "./diff-calculator";
import type { SchemaSnapshot, SnapshotFieldConfig } from "./snapshot-types";

function field(type: string, overrides: Partial<SnapshotFieldConfig> = {}): SnapshotFieldConfig {
  return { type, required: false, ...overrides };
}

function snapshot(fields: Record<string, SnapshotFieldConfig>): SchemaSnapshot {
  return {
    version: 1,
    namespace: "testdb",
    createdAt: "2026-01-01T00:00:00.000Z",
    types: { User: { ...snapshotType("User"), fields } },
  };
}

function typeChange(
  fieldName: string,
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
): DiffChange {
  return { kind: "field_type_modified", typeName: "User", fieldName, before, after };
}

describe("buildTempFieldName", () => {
  test("suffixes the field name", () => {
    expect(buildTempFieldName("price", new Set())).toBe("priceMigrate");
  });

  test("never produces an underscore, which the platform rejects", () => {
    expect(buildTempFieldName("price", new Set())).not.toContain("_");
  });

  test("appends an ordinal when the suffixed name is taken", () => {
    expect(buildTempFieldName("price", new Set(["priceMigrate"]))).toBe("priceMigrate2");
    expect(buildTempFieldName("price", new Set(["priceMigrate", "priceMigrate2"]))).toBe(
      "priceMigrate3",
    );
  });

  test("throws instead of truncating past the length limit", () => {
    const name = "a".repeat(60);
    expect(() => buildTempFieldName(name, new Set())).toThrow(/exceeds 63 characters/);
  });
});

describe("planExpandContract", () => {
  const previous = snapshot({ price: field("integer") });
  const current = snapshot({ price: field("string") });
  const confirmed = new Set(["User.price"]);

  function planning(changes: DiffChange[], breaking = unsupportedPrice()) {
    return planExpandContract({
      previous,
      current,
      diff: createMockMigrationDiff({ changes, breakingChanges: breaking }),
      confirmed,
    });
  }

  function unsupportedPrice() {
    return [
      {
        typeName: "User",
        fieldName: "price",
        reason: "Field type changed from integer to string",
        unsupported: true,
        showThreeStepHint: true,
      },
    ];
  }

  test("plans a confirmed scalar type change and clears it from blocked", () => {
    const { plans, blocked } = planning([typeChange("price", field("integer"), field("string"))]);

    expect(plans).toEqual([
      {
        typeName: "User",
        fieldName: "price",
        tempFieldName: "priceMigrate",
        before: field("integer"),
        after: field("string"),
      },
    ]);
    expect(blocked).toEqual([]);
  });

  test("blocks a change the user did not confirm", () => {
    const { plans, blocked } = planExpandContract({
      previous,
      current,
      diff: createMockMigrationDiff({
        changes: [typeChange("price", field("integer"), field("string"))],
        breakingChanges: unsupportedPrice(),
      }),
      confirmed: new Set(),
    });

    expect(plans).toEqual([]);
    expect(blocked).toHaveLength(1);
  });

  test.each([
    ["serial", { serial: { start: 1 } }],
    ["vector", { vector: true }],
    ["foreign keys", { foreignKey: true }],
    ["arrays", { array: true }],
  ] satisfies [string, Partial<SnapshotFieldConfig>][])("blocks %s", (_name, overrides) => {
    const { plans, blocked } = planning([
      typeChange("price", field("integer", overrides), field("string", overrides)),
    ]);

    expect(plans).toEqual([]);
    expect(blocked).toHaveLength(1);
  });

  test("avoids a temporary name the user already defined", () => {
    const { plans } = planExpandContract({
      previous: snapshot({ price: field("integer"), priceMigrate: field("string") }),
      current: snapshot({ price: field("string"), priceMigrate: field("string") }),
      diff: createMockMigrationDiff({
        changes: [typeChange("price", field("integer"), field("string"))],
        breakingChanges: unsupportedPrice(),
      }),
      confirmed,
    });

    expect(plans[0]?.tempFieldName).toBe("priceMigrate2");
  });

  test("keeps unrelated unsupported changes blocked", () => {
    const { plans, blocked } = planning(
      [typeChange("price", field("integer"), field("string"))],
      [
        ...unsupportedPrice(),
        {
          typeName: "User",
          fieldName: "tags",
          reason: "Field changed from single value to array",
          unsupported: true,
          showThreeStepHint: true,
        },
      ],
    );

    expect(plans).toHaveLength(1);
    expect(blocked).toEqual([expect.objectContaining({ fieldName: "tags" })]);
  });
});
