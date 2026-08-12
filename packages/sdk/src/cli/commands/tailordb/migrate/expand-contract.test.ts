import { describe, expect, test } from "vitest";
import { buildTempFieldName, planExpandContract } from "./expand-contract";
import { createMockMigrationDiff } from "./test-helpers/migration-diff";
import { snapshotField, snapshotType } from "./test-helpers/schema-fixtures";
import type { DiffChange } from "./diff-calculator";
import type { SchemaSnapshot, SnapshotFieldConfig, TailorDBSnapshotType } from "./snapshot-types";

function snapshot(fields: Record<string, SnapshotFieldConfig>): SchemaSnapshot {
  return {
    version: 1,
    namespace: "testdb",
    createdAt: "2026-01-01T00:00:00.000Z",
    types: { User: { ...snapshotType("User"), fields } },
  };
}

function snapshotWithType(
  fields: Record<string, SnapshotFieldConfig>,
  options: Partial<Omit<TailorDBSnapshotType, "fields" | "name" | "pluralForm">>,
): SchemaSnapshot {
  const base = snapshot(fields);
  base.types.User = { ...base.types.User!, ...options };
  return base;
}

function typeChange(
  fieldName: string,
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
): DiffChange {
  return { kind: "field_type_modified", tableName: "User", fieldName, before, after };
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
  const current = snapshot({ price: snapshotField("boolean") });
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
        tableName: "User",
        fieldName: "price",
        reason: "Field type changed from integer to boolean",
        unsupported: true,
        showThreeStepHint: true,
      },
    ];
  }

  test("plans a confirmed scalar type change and clears it from blocked", () => {
    const { plans, blocked } = planning([
      typeChange("price", snapshotField("integer"), snapshotField("boolean")),
    ]);

    expect(plans).toEqual([
      {
        tableName: "User",
        fieldName: "price",
        tempFieldName: "priceMigrate",
        before: snapshotField("integer"),
        after: snapshotField("boolean"),
      },
    ]);
    expect(blocked).toEqual([]);
  });

  test("blocks a change the user did not confirm", () => {
    const { plans, blocked } = planExpandContract({
      previous,
      current,
      diff: createMockMigrationDiff({
        changes: [typeChange("price", snapshotField("integer"), snapshotField("boolean"))],
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
      current: withIndex({ price: snapshotField("boolean") }),
      diff: createMockMigrationDiff({
        changes: [typeChange("price", snapshotField("integer"), snapshotField("boolean"))],
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
      current: snapshot({ price: snapshotField("boolean", overrides) }),
      diff: createMockMigrationDiff({
        changes: [
          typeChange(
            "price",
            snapshotField("integer", overrides),
            snapshotField("boolean", overrides),
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
      current: snapshot({ price: snapshotField("boolean") }),
      diff: createMockMigrationDiff({
        changes: [typeChange("price", snapshotField("integer"), snapshotField("boolean"))],
        breakingChanges: unsupportedPrice(),
      }),
      confirmed,
    });

    expect(plans).toEqual([]);
  });

  test("ignores longer field names and text in type scripts", () => {
    const typeValidateExpr =
      '(({ newRecord }, issues) => { if (!newRecord.wholesalePrice) issues("wholesalePrice", "price"); })({ newRecord: _newRecord, oldRecord: _oldRecord }, __issues)';
    const fields = {
      price: snapshotField("integer"),
      wholesalePrice: snapshotField("string"),
    };
    const { plans } = planExpandContract({
      previous: snapshotWithType(fields, { typeValidateExpr }),
      current: snapshotWithType(
        { ...fields, price: snapshotField("boolean") },
        { typeValidateExpr },
      ),
      diff: createMockMigrationDiff({
        changes: [typeChange("price", snapshotField("integer"), snapshotField("boolean"))],
        breakingChanges: unsupportedPrice(),
      }),
      confirmed,
    });

    expect(plans).toHaveLength(1);
  });

  test("ignores generated context plumbing that matches the field name", () => {
    const typeHookExpr = {
      update:
        "(({ input }) => ({ total: input.wholesalePrice }))({ input: _input, oldRecord: _oldRecord })",
    };
    const { plans } = planExpandContract({
      previous: snapshotWithType(
        { input: snapshotField("integer"), wholesalePrice: snapshotField("string") },
        { typeHookExpr },
      ),
      current: snapshotWithType(
        { input: snapshotField("boolean"), wholesalePrice: snapshotField("string") },
        { typeHookExpr },
      ),
      diff: createMockMigrationDiff({
        changes: [typeChange("input", snapshotField("integer"), snapshotField("boolean"))],
        breakingChanges: [
          {
            tableName: "User",
            fieldName: "input",
            reason: "Field type changed from integer to boolean",
            unsupported: true,
            showThreeStepHint: true,
          },
        ],
      }),
      confirmed: new Set(["User.input"]),
    });

    expect(plans).toHaveLength(1);
  });

  test("ignores permission users, literals, and descriptions that match the field name", () => {
    const permissions: NonNullable<TailorDBSnapshotType["permissions"]> = {
      record: {
        create: [
          {
            conditions: [[{ user: "price" }, "eq", "price"]],
            description: "Controls access to price updates",
            permit: "allow",
          },
        ],
        read: [],
        update: [],
        delete: [],
      },
    };
    const { plans } = planExpandContract({
      previous: snapshotWithType({ price: snapshotField("integer") }, { permissions }),
      current: snapshotWithType({ price: snapshotField("boolean") }, { permissions }),
      diff: createMockMigrationDiff({
        changes: [typeChange("price", snapshotField("integer"), snapshotField("boolean"))],
        breakingChanges: unsupportedPrice(),
      }),
      confirmed,
    });

    expect(plans).toHaveLength(1);
  });

  test.each([
    [
      "dot property",
      {
        typeHookExpr: {
          update:
            "(({ input }) => ({ total: input.price }))({ input: _input, oldRecord: _oldRecord })",
        },
      },
    ],
    [
      "computed property",
      {
        typeValidateExpr:
          '(({ newRecord }) => newRecord["price"] !== "")({ newRecord: _newRecord, oldRecord: _oldRecord })',
      },
    ],
    [
      "hook output",
      {
        typeHookExpr: {
          update: "(({ input }) => ({ price: input.wholesalePrice }))({ input: _input })",
        },
      },
    ],
    [
      "validation issue",
      {
        typeValidateExpr:
          '((_args, report) => { report("price", "Invalid value"); })({ newRecord: _newRecord }, __issues)',
      },
    ],
    [
      "helper alias",
      {
        typeHookExpr: {
          update:
            "(({ input }) => { const read = (record) => record.price; return { total: read(input) }; })({ input: _input })",
        },
      },
    ],
    [
      "derived object",
      {
        typeHookExpr: {
          update: "(({ input }) => ({ total: Object.assign({}, input).price }))({ input: _input })",
        },
      },
    ],
    [
      "template property",
      {
        typeValidateExpr:
          "(({ newRecord }) => newRecord[`price`] !== '')({ newRecord: _newRecord })",
      },
    ],
    [
      "Reflect.get",
      {
        typeValidateExpr:
          '(({ newRecord }) => Reflect.get(newRecord, "price") !== "")({ newRecord: _newRecord })',
      },
    ],
    [
      "computed key binding",
      {
        typeHookExpr: {
          update:
            '(({ input }) => { const key = "price"; return { total: input[key] }; })({ input: _input })',
        },
      },
    ],
    [
      "computed output key",
      {
        typeHookExpr: {
          update:
            '(({ input }) => { const key = "price"; return { [key]: input.wholesalePrice }; })({ input: _input })',
        },
      },
    ],
    [
      "Reflect.deleteProperty",
      {
        typeHookExpr: {
          update:
            '(({ input }) => { Reflect.deleteProperty(input, "price"); return input; })({ input: _input })',
        },
      },
    ],
    [
      "in operator",
      {
        typeValidateExpr: '(({ newRecord }) => "price" in newRecord)({ newRecord: _newRecord })',
      },
    ],
    [
      "hasOwnProperty.call",
      {
        typeValidateExpr:
          '(({ newRecord }) => Object.prototype.hasOwnProperty.call(newRecord, "price"))({ newRecord: _newRecord })',
      },
    ],
    [
      "Object.fromEntries",
      {
        typeHookExpr: {
          update:
            '(({ input }) => Object.fromEntries([["price", input.wholesalePrice]]))({ input: _input })',
        },
      },
    ],
    [
      "template validation issue",
      {
        typeValidateExpr:
          "((_args, report) => { report(`price`, 'Invalid value'); })({ newRecord: _newRecord }, __issues)",
      },
    ],
  ] satisfies [string, Partial<Omit<TailorDBSnapshotType, "fields" | "name" | "pluralForm">>][])(
    "blocks an exact field reference through a type script: %s",
    (_name, options) => {
      const { plans } = planExpandContract({
        previous: snapshotWithType({ price: snapshotField("integer") }, options),
        current: snapshotWithType({ price: snapshotField("boolean") }, options),
        diff: createMockMigrationDiff({
          changes: [typeChange("price", snapshotField("integer"), snapshotField("boolean"))],
          breakingChanges: unsupportedPrice(),
        }),
        confirmed,
      });

      expect(plans).toEqual([]);
    },
  );

  test("blocks an exact record field reference in permissions", () => {
    const permissions: NonNullable<TailorDBSnapshotType["permissions"]> = {
      record: {
        create: [],
        read: [
          {
            conditions: [[{ record: "price" }, "eq", "visible"]],
            permit: "allow",
          },
        ],
        update: [],
        delete: [],
      },
    };
    const { plans } = planExpandContract({
      previous: snapshotWithType({ price: snapshotField("integer") }, { permissions }),
      current: snapshotWithType({ price: snapshotField("boolean") }, { permissions }),
      diff: createMockMigrationDiff({
        changes: [typeChange("price", snapshotField("integer"), snapshotField("boolean"))],
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
      current: withMembers({ price: snapshotField("boolean") }),
      diff: createMockMigrationDiff({
        changes: [typeChange("price", snapshotField("integer"), snapshotField("boolean"))],
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
      current: snapshot({ price: snapshotField("boolean"), priceMigrate: snapshotField("string") }),
      diff: createMockMigrationDiff({
        changes: [typeChange("price", snapshotField("integer"), snapshotField("boolean"))],
        breakingChanges: unsupportedPrice(),
      }),
      confirmed,
    });

    expect(plans[0]?.tempFieldName).toBe("priceMigrate2");
  });

  test("keeps unrelated unsupported changes blocked", () => {
    const { plans, blocked } = planning(
      [typeChange("price", snapshotField("integer"), snapshotField("boolean"))],
      [
        ...unsupportedPrice(),
        {
          tableName: "User",
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
