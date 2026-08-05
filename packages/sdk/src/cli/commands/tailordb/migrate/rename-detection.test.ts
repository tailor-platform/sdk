import { describe, expect, test } from "vitest";
import { findRenameCandidates, isRenameCompatible, parseRenameOption } from "./rename-detection";
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

describe("parseRenameOption", () => {
  test("parses Type.old:new", () => {
    expect(parseRenameOption("User.fullName:displayName")).toEqual({
      typeName: "User",
      fromFieldName: "fullName",
      toFieldName: "displayName",
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
