import { describe, expect, test } from "vitest";
import {
  assertValidFieldRenames,
  dropSpecApplies,
  findRenameCandidates,
  isRenameCompatible,
  parseDropOption,
  parseRenameOption,
  renameSpecApplies,
} from "./rename-detection";
import { normalizeSchemaSnapshot } from "./snapshot";
import { createMockMigrationDiff } from "./test-helpers/migration-diff";
import type { SnapshotFieldConfig } from "./snapshot-types";

const stringField = (overrides: Partial<SnapshotFieldConfig> = {}): SnapshotFieldConfig => ({
  type: "string",
  required: false,
  ...overrides,
});

describe("isRenameCompatible", () => {
  test("accepts same type and array-ness", () => {
    expect(isRenameCompatible(stringField(), stringField())).toBe(true);
    expect(isRenameCompatible(stringField({ array: true }), stringField({ array: true }))).toBe(
      true,
    );
  });

  test("accepts required change", () => {
    expect(isRenameCompatible(stringField(), stringField({ required: true }))).toBe(true);
  });

  test("rejects different field types", () => {
    expect(isRenameCompatible(stringField(), stringField({ type: "integer" }))).toBe(false);
  });

  test("rejects different array-ness", () => {
    expect(isRenameCompatible(stringField(), stringField({ array: true }))).toBe(false);
  });

  test("rejects different foreign key targets", () => {
    expect(
      isRenameCompatible(
        stringField({ type: "uuid", foreignKey: true, foreignKeyType: "Company" }),
        stringField({ type: "uuid", foreignKey: true, foreignKeyType: "Team" }),
      ),
    ).toBe(false);
  });

  test("rejects different foreign key fields", () => {
    expect(
      isRenameCompatible(
        stringField({
          type: "uuid",
          foreignKey: true,
          foreignKeyType: "Company",
          foreignKeyField: "id",
        }),
        stringField({
          type: "uuid",
          foreignKey: true,
          foreignKeyType: "Company",
          foreignKeyField: "slug",
        }),
      ),
    ).toBe(false);
  });

  test("rejects serial fields", () => {
    expect(isRenameCompatible(stringField({ serial: { start: 1 } }), stringField())).toBe(false);
    expect(isRenameCompatible(stringField(), stringField({ serial: { start: 1 } }))).toBe(false);
  });

  test("rejects nested renames whose member structure differs", () => {
    const nested = (fields: Record<string, SnapshotFieldConfig>): SnapshotFieldConfig =>
      stringField({ type: "nested", fields });

    expect(
      isRenameCompatible(
        nested({ legacy: stringField() }),
        nested({ replacement: stringField({ type: "integer" }) }),
      ),
    ).toBe(false);
    expect(
      isRenameCompatible(
        nested({ legacy: stringField() }),
        nested({ legacy: stringField(), extra: stringField() }),
      ),
    ).toBe(false);
    expect(
      isRenameCompatible(
        nested({ legacy: stringField() }),
        nested({ legacy: stringField({ required: true }) }),
      ),
    ).toBe(false);
    expect(
      isRenameCompatible(nested({ legacy: stringField() }), nested({ legacy: stringField() })),
    ).toBe(true);
  });

  test("rejects enum renames that remove values", () => {
    const before = stringField({
      type: "enum",
      allowedValues: [{ value: "A" }, { value: "B" }],
    });
    const shrunk = stringField({ type: "enum", allowedValues: [{ value: "A" }] });
    const grown = stringField({
      type: "enum",
      allowedValues: [{ value: "A" }, { value: "B" }, { value: "C" }],
    });
    expect(isRenameCompatible(before, shrunk)).toBe(false);
    expect(isRenameCompatible(before, grown)).toBe(true);
  });
});

describe("assertValidFieldRenames", () => {
  const snapshot = (fields: Record<string, SnapshotFieldConfig>) =>
    normalizeSchemaSnapshot({
      version: 1,
      namespace: "tailordb",
      createdAt: new Date().toISOString(),
      types: { User: { name: "User", pluralForm: "Users", fields } },
    });

  test("explains nested member structure incompatibility", () => {
    const nested = (fields: Record<string, SnapshotFieldConfig>): SnapshotFieldConfig =>
      stringField({ type: "nested", fields });

    expect(() =>
      assertValidFieldRenames(
        snapshot({ fullName: nested({ legacy: stringField() }) }),
        snapshot({ displayName: nested({ replacement: stringField() }) }),
        [{ typeName: "User", previousFieldName: "fullName", fieldName: "displayName" }],
      ),
    ).toThrow("nested member names, requiredness, and types must match recursively");
  });
});

describe("findRenameCandidates", () => {
  test("pairs a removed field with compatible added fields in the same type", () => {
    const diff = createMockMigrationDiff({
      changes: [
        {
          kind: "field_removed",
          typeName: "User",
          fieldName: "fullName",
          before: stringField(),
        },
        {
          kind: "field_added",
          typeName: "User",
          fieldName: "displayName",
          after: stringField(),
        },
        {
          kind: "field_added",
          typeName: "User",
          fieldName: "age",
          after: stringField({ type: "integer" }),
        },
      ],
    });

    const candidates = findRenameCandidates(diff);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.typeName).toBe("User");
    expect(candidates[0]!.removed.fieldName).toBe("fullName");
    expect(candidates[0]!.added.map((a) => a.fieldName)).toEqual(["displayName"]);
  });

  test("does not pair fields across types", () => {
    const diff = createMockMigrationDiff({
      changes: [
        {
          kind: "field_removed",
          typeName: "User",
          fieldName: "fullName",
          before: stringField(),
        },
        {
          kind: "field_added",
          typeName: "Company",
          fieldName: "displayName",
          after: stringField(),
        },
      ],
    });

    expect(findRenameCandidates(diff)).toHaveLength(0);
  });

  test("returns no candidates when nothing is compatible", () => {
    const diff = createMockMigrationDiff({
      changes: [
        {
          kind: "field_removed",
          typeName: "User",
          fieldName: "fullName",
          before: stringField(),
        },
        {
          kind: "field_added",
          typeName: "User",
          fieldName: "age",
          after: stringField({ type: "integer" }),
        },
      ],
    });

    expect(findRenameCandidates(diff)).toHaveLength(0);
  });

  test("lists multiple compatible added fields for one removed field", () => {
    const diff = createMockMigrationDiff({
      changes: [
        {
          kind: "field_removed",
          typeName: "User",
          fieldName: "fullName",
          before: stringField(),
        },
        {
          kind: "field_added",
          typeName: "User",
          fieldName: "displayName",
          after: stringField(),
        },
        {
          kind: "field_added",
          typeName: "User",
          fieldName: "nickname",
          after: stringField(),
        },
      ],
    });

    const candidates = findRenameCandidates(diff);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.added.map((a) => a.fieldName)).toEqual(["displayName", "nickname"]);
  });
});

describe("renameSpecApplies", () => {
  const snapshot = (
    fields: Record<string, SnapshotFieldConfig>,
  ): Parameters<typeof renameSpecApplies>[1] => ({
    version: 1,
    namespace: "tailordb",
    createdAt: new Date().toISOString(),
    types: { User: { name: "User", pluralForm: "Users", fields } },
  });
  const spec = { typeName: "User", previousFieldName: "fullName", fieldName: "displayName" };

  test("matches a removed + added pair", () => {
    expect(
      renameSpecApplies(
        spec,
        snapshot({ fullName: stringField() }),
        snapshot({ displayName: stringField() }),
      ),
    ).toBe(true);
  });

  test("does not match when the old field still exists", () => {
    expect(
      renameSpecApplies(
        spec,
        snapshot({ fullName: stringField() }),
        snapshot({ fullName: stringField(), displayName: stringField() }),
      ),
    ).toBe(false);
  });

  test("does not match when the new field is missing", () => {
    expect(renameSpecApplies(spec, snapshot({ fullName: stringField() }), snapshot({}))).toBe(
      false,
    );
  });

  test("does not match when the type does not exist", () => {
    expect(
      renameSpecApplies(
        { ...spec, typeName: "Ghost" },
        snapshot({ fullName: stringField() }),
        snapshot({ displayName: stringField() }),
      ),
    ).toBe(false);
  });
});

describe("dropSpecApplies", () => {
  const snapshot = (
    fields: Record<string, SnapshotFieldConfig>,
  ): Parameters<typeof dropSpecApplies>[1] => ({
    version: 1,
    namespace: "tailordb",
    createdAt: new Date().toISOString(),
    types: { User: { name: "User", pluralForm: "Users", fields } },
  });
  const spec = { typeName: "User", fieldName: "fullName" };

  test("matches a removed field", () => {
    expect(dropSpecApplies(spec, snapshot({ fullName: stringField() }), snapshot({}))).toBe(true);
  });

  test("does not match when the field still exists", () => {
    expect(
      dropSpecApplies(
        spec,
        snapshot({ fullName: stringField() }),
        snapshot({ fullName: stringField() }),
      ),
    ).toBe(false);
  });

  test("does not match when the field never existed", () => {
    expect(dropSpecApplies(spec, snapshot({}), snapshot({}))).toBe(false);
  });
});

describe("parseDropOption", () => {
  test("parses Type.field", () => {
    expect(parseDropOption("User.fullName")).toEqual({
      typeName: "User",
      fieldName: "fullName",
    });
  });

  test.each(["User", "User.a.b", "User.a:b", "User..a", ""])(
    "rejects malformed value %j",
    (value) => {
      expect(() => parseDropOption(value)).toThrow("Expected format");
    },
  );
});

describe("parseRenameOption", () => {
  test("parses Type.old:new", () => {
    expect(parseRenameOption("User.fullName:displayName")).toEqual({
      typeName: "User",
      previousFieldName: "fullName",
      fieldName: "displayName",
    });
  });

  test.each(["User", "User.fullName", "User:fullName:displayName", "User..a:b", "a.b:c:d", ""])(
    "rejects malformed value %j",
    (value) => {
      expect(() => parseRenameOption(value)).toThrow("Expected format");
    },
  );

  test("rejects identical old and new names", () => {
    expect(() => parseRenameOption("User.name:name")).toThrow("identical");
  });
});
