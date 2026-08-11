import { describe, expect, test } from "vitest";
import { buildTempFieldName, planExpandContract } from "./expand-contract";
import { createMockMigrationDiff } from "./test-helpers/migration-diff";
import { snapshotField, snapshotType } from "./test-helpers/schema-fixtures";
import type { DiffChange } from "./diff-calculator";
import type { SchemaSnapshot, SnapshotFieldConfig } from "./snapshot-types";

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
  const previous = snapshot({ price: snapshotField("integer") });
  const current = snapshot({ price: snapshotField("string") });
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
    const { plans, blocked } = planning([
      typeChange("price", snapshotField("integer"), snapshotField("string")),
    ]);

    expect(plans).toEqual([
      {
        typeName: "User",
        fieldName: "price",
        tempFieldName: "priceMigrate",
        before: snapshotField("integer"),
        after: snapshotField("string"),
      },
    ]);
    expect(blocked).toEqual([]);
  });

  test("blocks a change the user did not confirm", () => {
    const { plans, blocked } = planExpandContract({
      previous,
      current,
      diff: createMockMigrationDiff({
        changes: [typeChange("price", snapshotField("integer"), snapshotField("string"))],
        breakingChanges: unsupportedPrice(),
      }),
      confirmed: new Set(),
    });

    expect(plans).toEqual([]);
    expect(blocked).toHaveLength(1);
  });

  test("blocks a pair the SDK already converts in one migration", () => {
    const { plans, blocked } = planExpandContract({
      previous: snapshot({ price: snapshotField("integer") }),
      current: snapshot({ price: snapshotField("float") }),
      diff: createMockMigrationDiff({
        changes: [typeChange("price", snapshotField("integer"), snapshotField("float"))],
        breakingChanges: [],
      }),
      confirmed,
    });

    expect(plans).toEqual([]);
    expect(blocked).toEqual([]);
  });

  test("blocks a field an index still points at", () => {
    const withIndex = (fields: Record<string, SnapshotFieldConfig>): SchemaSnapshot => {
      const base = snapshot(fields);
      base.types.User = {
        ...base.types.User!,
        indexes: { byPrice: { fields: ["price"] } },
      };
      return base;
    };
    const { plans, blocked } = planExpandContract({
      previous: withIndex({ price: snapshotField("integer") }),
      current: withIndex({ price: snapshotField("string") }),
      diff: createMockMigrationDiff({
        changes: [typeChange("price", snapshotField("integer"), snapshotField("string"))],
        breakingChanges: unsupportedPrice(),
      }),
      confirmed,
    });

    expect(plans).toEqual([]);
    expect(blocked).toHaveLength(1);
  });

  test.each([
    ["serial", { serial: { start: 1 } }],
    ["vector", { vector: true }],
    ["foreign keys", { foreignKey: true }],
    ["arrays", { array: true }],
    ["unique fields", { unique: true }],
  ] satisfies [string, Partial<SnapshotFieldConfig>][])("blocks %s", (_name, overrides) => {
    const { plans, blocked } = planExpandContract({
      previous: snapshot({ price: snapshotField("integer", overrides) }),
      current: snapshot({ price: snapshotField("string", overrides) }),
      diff: createMockMigrationDiff({
        changes: [
          typeChange(
            "price",
            snapshotField("integer", overrides),
            snapshotField("string", overrides),
          ),
        ],
        breakingChanges: unsupportedPrice(),
      }),
      confirmed,
    });

    expect(plans).toEqual([]);
    expect(blocked).toHaveLength(1);
  });

  test("blocks a field a reference in the previous schema still names", () => {
    const withIndex = (fields: Record<string, SnapshotFieldConfig>): SchemaSnapshot => {
      const base = snapshot(fields);
      base.types.User = {
        ...base.types.User!,
        indexes: { byPrice: { fields: ["price"] } },
      };
      return base;
    };
    const { plans } = planExpandContract({
      previous: withIndex({ price: snapshotField("integer") }),
      // The same edit drops the index, so only the previous snapshot names it.
      current: snapshot({ price: snapshotField("string") }),
      diff: createMockMigrationDiff({
        changes: [typeChange("price", snapshotField("integer"), snapshotField("string"))],
        breakingChanges: unsupportedPrice(),
      }),
      confirmed,
    });

    expect(plans).toEqual([]);
  });

  test("avoids a temporary name a file or relationship already exposes", () => {
    const withMembers = (fields: Record<string, SnapshotFieldConfig>): SchemaSnapshot => {
      const base = snapshot(fields);
      base.types.User = {
        ...base.types.User!,
        files: { priceMigrate: "text/csv" },
        forwardRelationships: {
          priceMigrate2: {
            targetType: "Other",
            targetField: "id",
            sourceField: "otherId",
            isArray: false,
            description: "",
          },
        },
      };
      return base;
    };
    const { plans } = planExpandContract({
      previous: withMembers({ price: snapshotField("integer") }),
      current: withMembers({ price: snapshotField("string") }),
      diff: createMockMigrationDiff({
        changes: [typeChange("price", snapshotField("integer"), snapshotField("string"))],
        breakingChanges: unsupportedPrice(),
      }),
      confirmed,
    });

    // Both share the type's GraphQL namespace with fields.
    expect(plans[0]?.tempFieldName).toBe("priceMigrate3");
  });

  test("avoids a temporary name the user already defined", () => {
    const { plans } = planExpandContract({
      previous: snapshot({
        price: snapshotField("integer"),
        priceMigrate: snapshotField("string"),
      }),
      current: snapshot({ price: snapshotField("string"), priceMigrate: snapshotField("string") }),
      diff: createMockMigrationDiff({
        changes: [typeChange("price", snapshotField("integer"), snapshotField("string"))],
        breakingChanges: unsupportedPrice(),
      }),
      confirmed,
    });

    expect(plans[0]?.tempFieldName).toBe("priceMigrate2");
  });

  test("keeps unrelated unsupported changes blocked", () => {
    const { plans, blocked } = planning(
      [typeChange("price", snapshotField("integer"), snapshotField("string"))],
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
