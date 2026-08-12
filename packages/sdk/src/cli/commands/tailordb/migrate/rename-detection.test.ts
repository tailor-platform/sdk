import { describe, expect, test } from "vitest";
import {
  assertValidFieldRenames,
  assertValidTypeRenames,
  dropSpecApplies,
  findRenameCandidates,
  findTypeRenameCandidates,
  isBreakingForeignKeyRetarget,
  isRenameCompatible,
  isTypeRenameCompatible,
  parseDropOption,
  parseRenameOption,
  parseTypeDropOption,
  parseTypeRenameOption,
  renameSpecApplies,
  typeDropSpecApplies,
  typeRenameSpecApplies,
} from "./rename-detection";
import { normalizeSchemaSnapshot } from "./snapshot";
import { createMockMigrationDiff } from "./test-helpers/migration-diff";
import type { SnapshotFieldConfig, TailorDBSnapshotType } from "./snapshot-types";

const stringField = (overrides: Partial<SnapshotFieldConfig> = {}): SnapshotFieldConfig => ({
  type: "string",
  required: false,
  ...overrides,
});

const snapshotType = (
  name: string,
  overrides: Partial<TailorDBSnapshotType> = {},
): TailorDBSnapshotType => ({
  name,
  pluralForm: `${name}s`,
  fields: {
    id: { type: "uuid", required: true },
    name: stringField(),
  },
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

describe("isTypeRenameCompatible", () => {
  test("accepts identical shapes", () => {
    expect(isTypeRenameCompatible(snapshotType("User"), snapshotType("Person"))).toBe(true);
  });

  test("tolerates name-derived and data-independent differences", () => {
    expect(
      isTypeRenameCompatible(
        snapshotType("User", { description: "old", settings: { aggregation: true } }),
        snapshotType("Person", {
          pluralForm: "People",
          description: "new",
          settings: { aggregation: false },
          permissions: { gql: [] },
        }),
      ),
    ).toBe(true);
  });

  test("accepts self-referential foreign keys retargeted at the new name", () => {
    const withSelfFk = (name: string, target: string) =>
      snapshotType(name, {
        fields: {
          id: { type: "uuid", required: true },
          parentId: stringField({ type: "uuid", foreignKey: true, foreignKeyType: target }),
        },
      });
    expect(isTypeRenameCompatible(withSelfFk("User", "User"), withSelfFk("Person", "Person"))).toBe(
      true,
    );
    expect(isTypeRenameCompatible(withSelfFk("User", "Team"), withSelfFk("Person", "Person"))).toBe(
      false,
    );
  });

  test("rejects differing field sets or field shapes", () => {
    expect(
      isTypeRenameCompatible(
        snapshotType("User"),
        snapshotType("Person", {
          fields: { id: { type: "uuid", required: true }, fullName: stringField() },
        }),
      ),
    ).toBe(false);
    expect(
      isTypeRenameCompatible(
        snapshotType("User"),
        snapshotType("Person", {
          fields: {
            id: { type: "uuid", required: true },
            name: stringField({ type: "integer" }),
          },
        }),
      ),
    ).toBe(false);
  });

  test("rejects required and unique constraint tightening or loosening", () => {
    expect(
      isTypeRenameCompatible(
        snapshotType("User"),
        snapshotType("Person", {
          fields: {
            id: { type: "uuid", required: true },
            name: stringField({ required: true }),
          },
        }),
      ),
    ).toBe(false);
    expect(
      isTypeRenameCompatible(
        snapshotType("User"),
        snapshotType("Person", {
          fields: { id: { type: "uuid", required: true }, name: stringField({ unique: true }) },
        }),
      ),
    ).toBe(false);
  });

  test("rejects nested required and unique constraint differences", () => {
    const withNestedMember = (name: string, member: SnapshotFieldConfig) =>
      snapshotType(name, {
        fields: {
          id: { type: "uuid", required: true },
          profile: stringField({ type: "nested", fields: { value: member } }),
        },
      });

    expect(
      isTypeRenameCompatible(
        withNestedMember("User", stringField()),
        withNestedMember("Person", stringField({ required: true })),
      ),
    ).toBe(false);
    expect(
      isTypeRenameCompatible(
        withNestedMember("User", stringField()),
        withNestedMember("Person", stringField({ unique: true })),
      ),
    ).toBe(false);
  });

  test("rejects a required self-referential foreign key", () => {
    const withSelfFk = (name: string, required: boolean) =>
      snapshotType(name, {
        fields: {
          id: { type: "uuid", required: true },
          parentId: stringField({
            type: "uuid",
            foreignKey: true,
            foreignKeyType: name,
            required,
          }),
        },
      });
    expect(isTypeRenameCompatible(withSelfFk("User", true), withSelfFk("Person", true))).toBe(
      false,
    );
    expect(isTypeRenameCompatible(withSelfFk("User", false), withSelfFk("Person", false))).toBe(
      true,
    );
  });

  test("rejects types with serial or file fields", () => {
    expect(
      isTypeRenameCompatible(
        snapshotType("User", {
          fields: {
            id: { type: "uuid", required: true },
            code: stringField({ serial: { start: 1 } }),
          },
        }),
        snapshotType("Person", {
          fields: {
            id: { type: "uuid", required: true },
            code: stringField({ serial: { start: 1 } }),
          },
        }),
      ),
    ).toBe(false);
    expect(
      isTypeRenameCompatible(
        snapshotType("User", { files: { avatar: "avatar image" } }),
        snapshotType("Person", { files: { avatar: "avatar image" } }),
      ),
    ).toBe(false);
  });

  test("rejects differing indexes", () => {
    expect(
      isTypeRenameCompatible(
        snapshotType("User", { indexes: { byName: { fields: ["name"] } } }),
        snapshotType("Person"),
      ),
    ).toBe(false);
    expect(
      isTypeRenameCompatible(
        snapshotType("User", { indexes: { byName: { fields: ["name"] } } }),
        snapshotType("Person", { indexes: { byName: { fields: ["name"] } } }),
      ),
    ).toBe(true);
  });

  test("rejects differing decimal scales", () => {
    const withScale = (name: string, scale?: number) =>
      snapshotType(name, {
        fields: {
          id: { type: "uuid", required: true },
          price: stringField({ type: "decimal", ...(scale !== undefined && { scale }) }),
        },
      });
    expect(isTypeRenameCompatible(withScale("User", 2), withScale("Person", 4))).toBe(false);
    expect(isTypeRenameCompatible(withScale("User", 2), withScale("Person", 2))).toBe(true);
  });

  test("rejects differing nested decimal scales", () => {
    const withNestedScale = (name: string, scale: number) =>
      snapshotType(name, {
        fields: {
          id: { type: "uuid", required: true },
          metrics: stringField({
            type: "nested",
            fields: { price: stringField({ type: "decimal", scale }) },
          }),
        },
      });

    expect(isTypeRenameCompatible(withNestedScale("User", 2), withNestedScale("Person", 4))).toBe(
      false,
    );
    expect(isTypeRenameCompatible(withNestedScale("User", 2), withNestedScale("Person", 2))).toBe(
      true,
    );
  });
});

describe("isBreakingForeignKeyRetarget", () => {
  const fk = (target: string, field?: string): SnapshotFieldConfig =>
    stringField({
      type: "uuid",
      foreignKey: true,
      foreignKeyType: target,
      ...(field !== undefined && { foreignKeyField: field }),
    });
  const renames = new Map([["User", "Person"]]);

  test("suppresses a retarget that follows a confirmed rename", () => {
    expect(isBreakingForeignKeyRetarget(fk("User"), fk("Person"), renames)).toBe(false);
    expect(isBreakingForeignKeyRetarget(fk("User", "id"), fk("Person", "id"), renames)).toBe(false);
  });

  test("flags a retarget whose referenced field also changes", () => {
    expect(isBreakingForeignKeyRetarget(fk("User", "id"), fk("Person", "slug"), renames)).toBe(
      true,
    );
  });

  test("flags a retarget unrelated to any rename", () => {
    expect(isBreakingForeignKeyRetarget(fk("Team"), fk("Org"), renames)).toBe(true);
    expect(isBreakingForeignKeyRetarget(fk("Team"), fk("Org"))).toBe(true);
  });

  test("ignores fields without a foreign key target change", () => {
    expect(isBreakingForeignKeyRetarget(fk("User"), fk("User"), renames)).toBe(false);
    expect(isBreakingForeignKeyRetarget(stringField(), stringField(), renames)).toBe(false);
  });
});

describe("findTypeRenameCandidates", () => {
  test("pairs a removed type with compatible added types", () => {
    const diff = createMockMigrationDiff({
      changes: [
        { kind: "table_removed", typeName: "User", before: snapshotType("User") },
        { kind: "table_added", typeName: "Person", after: snapshotType("Person") },
        {
          kind: "table_added",
          typeName: "Order",
          after: snapshotType("Order", {
            fields: { id: { type: "uuid", required: true }, total: stringField() },
          }),
        },
      ],
    });

    const candidates = findTypeRenameCandidates(diff);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.removed.typeName).toBe("User");
    expect(candidates[0]!.added.map((a) => a.typeName)).toEqual(["Person"]);
  });

  test("returns no candidates when nothing is compatible", () => {
    const diff = createMockMigrationDiff({
      changes: [
        { kind: "table_removed", typeName: "User", before: snapshotType("User") },
        {
          kind: "table_added",
          typeName: "Order",
          after: snapshotType("Order", {
            fields: { id: { type: "uuid", required: true }, total: stringField() },
          }),
        },
      ],
    });

    expect(findTypeRenameCandidates(diff)).toHaveLength(0);
  });

  test("lists multiple compatible added types for one removed type", () => {
    const diff = createMockMigrationDiff({
      changes: [
        { kind: "table_removed", typeName: "User", before: snapshotType("User") },
        { kind: "table_added", typeName: "Person", after: snapshotType("Person") },
        { kind: "table_added", typeName: "Member", after: snapshotType("Member") },
      ],
    });

    const candidates = findTypeRenameCandidates(diff);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.added.map((a) => a.typeName)).toEqual(["Person", "Member"]);
  });
});

describe("typeRenameSpecApplies", () => {
  const snapshot = (types: Record<string, TailorDBSnapshotType>) => ({
    version: 1,
    namespace: "tailordb",
    createdAt: new Date().toISOString(),
    types,
  });
  const spec = { previousTypeName: "User", typeName: "Person" };

  test("matches a removed + added pair", () => {
    expect(
      typeRenameSpecApplies(
        spec,
        snapshot({ User: snapshotType("User") }),
        snapshot({ Person: snapshotType("Person") }),
      ),
    ).toBe(true);
  });

  test("does not match when the old type still exists", () => {
    expect(
      typeRenameSpecApplies(
        spec,
        snapshot({ User: snapshotType("User") }),
        snapshot({ User: snapshotType("User"), Person: snapshotType("Person") }),
      ),
    ).toBe(false);
  });

  test("does not match when the new type is missing", () => {
    expect(
      typeRenameSpecApplies(spec, snapshot({ User: snapshotType("User") }), snapshot({})),
    ).toBe(false);
  });
});

describe("assertValidTypeRenames", () => {
  const normalized = (types: Record<string, TailorDBSnapshotType>) =>
    normalizeSchemaSnapshot({
      version: 1,
      namespace: "tailordb",
      createdAt: new Date().toISOString(),
      types,
    });

  test("accepts a compatible removed + added pair", () => {
    expect(() =>
      assertValidTypeRenames(
        normalized({ User: snapshotType("User") }),
        normalized({ Person: snapshotType("Person") }),
        [{ previousTypeName: "User", typeName: "Person" }],
      ),
    ).not.toThrow();
  });

  test("rejects a type participating in two renames", () => {
    expect(() =>
      assertValidTypeRenames(
        normalized({ User: snapshotType("User") }),
        normalized({ Person: snapshotType("Person") }),
        [
          { previousTypeName: "User", typeName: "Person" },
          { previousTypeName: "User", typeName: "Person" },
        ],
      ),
    ).toThrow("appears in more than one rename");
  });

  test("rejects a rename whose old type is missing from the previous schema", () => {
    expect(() =>
      assertValidTypeRenames(normalized({}), normalized({ Person: snapshotType("Person") }), [
        { previousTypeName: "User", typeName: "Person" },
      ]),
    ).toThrow('type "User" does not exist in the previous schema');
  });

  test("rejects a rename whose new type is missing from the current schema", () => {
    expect(() =>
      assertValidTypeRenames(normalized({ User: snapshotType("User") }), normalized({}), [
        { previousTypeName: "User", typeName: "Person" },
      ]),
    ).toThrow('type "Person" does not exist in the current schema');
  });

  test("explains shape incompatibility", () => {
    expect(() =>
      assertValidTypeRenames(
        normalized({ User: snapshotType("User") }),
        normalized({
          Person: snapshotType("Person", {
            fields: { id: { type: "uuid", required: true }, fullName: stringField() },
          }),
        }),
        [{ previousTypeName: "User", typeName: "Person" }],
      ),
    ).toThrow("not rename-compatible");
  });
});

describe("parseTypeRenameOption", () => {
  test("parses OldType:NewType", () => {
    expect(parseTypeRenameOption("User:Person")).toEqual({
      previousTypeName: "User",
      typeName: "Person",
    });
  });

  test.each(["User", "User:Person:Extra", "User.name:Person", ":Person", "User:", ""])(
    "rejects malformed value %j",
    (value) => {
      expect(() => parseTypeRenameOption(value)).toThrow("Expected format");
    },
  );

  test("rejects identical old and new names", () => {
    expect(() => parseTypeRenameOption("User:User")).toThrow("identical");
  });
});

describe("parseTypeDropOption", () => {
  test("parses Type", () => {
    expect(parseTypeDropOption("User")).toEqual({ typeName: "User" });
  });

  test.each(["User.name", "User:Person", ""])("rejects malformed value %j", (value) => {
    expect(() => parseTypeDropOption(value)).toThrow("Expected format");
  });
});

describe("typeDropSpecApplies", () => {
  const snapshot = (types: Record<string, TailorDBSnapshotType>) => ({
    version: 1,
    namespace: "tailordb",
    createdAt: new Date().toISOString(),
    types,
  });

  test("matches a removed type", () => {
    expect(
      typeDropSpecApplies(
        { typeName: "User" },
        snapshot({ User: snapshotType("User") }),
        snapshot({}),
      ),
    ).toBe(true);
  });

  test("does not match when the type still exists", () => {
    expect(
      typeDropSpecApplies(
        { typeName: "User" },
        snapshot({ User: snapshotType("User") }),
        snapshot({ User: snapshotType("User") }),
      ),
    ).toBe(false);
  });
});
