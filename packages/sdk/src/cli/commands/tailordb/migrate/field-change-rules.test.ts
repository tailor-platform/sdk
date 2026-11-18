import { describe, expect, test } from "vitest";
import { collectBreakingFieldChanges, scaffoldFieldChange } from "./field-change-rules";
import type { SnapshotFieldConfig } from "./snapshot-types";

const reasons = (
  before: SnapshotFieldConfig | undefined,
  after: SnapshotFieldConfig,
  typeRenameTargets?: ReadonlyMap<string, string>,
) =>
  collectBreakingFieldChanges(
    { tableName: "Order", fieldName: "ownerId" },
    { before, after, nestedMember: false, typeRenameTargets },
  ).map(({ reason }) => reason);

const fk = (target: string, field?: string): SnapshotFieldConfig => ({
  type: "uuid",
  required: false,
  foreignKey: true,
  foreignKeyType: target,
  ...(field !== undefined && { foreignKeyField: field }),
});

describe("collectBreakingFieldChanges", () => {
  test.each<[string, SnapshotFieldConfig]>([
    ["unique", { type: "string", required: false, unique: true }],
    ["array", { type: "string", required: false, array: true }],
    ["enum", { type: "enum", required: false, allowedValues: [{ value: "a" }] }],
    ["decimal", { type: "decimal", required: false, scale: 2 }],
    ["relation", fk("User", "id")],
  ])("does not flag an added optional %s field", (_, added) => {
    expect(reasons(undefined, added)).toEqual([]);
  });

  test("reports a field's breaking changes in the order its statements run", () => {
    const before = fk("User", "id");
    const after = { ...fk("Account", "id"), required: true };

    expect(reasons(before, after)).toEqual([
      "Foreign key target changed from User.id to Account.id",
      "Field changed from optional to required",
    ]);
    const statements = scaffoldFieldChange(
      { kind: "field_modified", tableName: "Order", fieldName: "ownerId", before, after },
      new Map(),
    );
    expect(statements.map((statement) => statement.split("\n")[0])).toEqual([
      "  // Migrate ownerId references from User.id to Account.id",
      "  // Set ownerId for Order records where it is null",
    ]);
  });
});

describe("collectBreakingFieldChanges: foreign key retargets", () => {
  const renames = new Map([["User", "Person"]]);

  test("suppresses a retarget that follows a confirmed rename", () => {
    expect(reasons(fk("User"), fk("Person"), renames)).toEqual([]);
    expect(reasons(fk("User", "id"), fk("Person", "id"), renames)).toEqual([]);
  });

  test("flags a retarget whose referenced field also changes", () => {
    expect(reasons(fk("User", "id"), fk("Person", "slug"), renames)).toEqual([
      "Foreign key target changed from User.id to Person.slug",
    ]);
  });

  test("flags a retarget to another key of the same table", () => {
    expect(reasons(fk("User", "id"), fk("User", "email"), renames)).toEqual([
      "Foreign key target changed from User.id to User.email",
    ]);
  });

  test("flags a retarget unrelated to any rename", () => {
    const expected = ["Foreign key target changed from Team.id to Org.id"];
    expect(reasons(fk("Team"), fk("Org"), renames)).toEqual(expected);
    expect(reasons(fk("Team"), fk("Org"))).toEqual(expected);
  });

  test("ignores fields without a foreign key target change", () => {
    const plain: SnapshotFieldConfig = { type: "uuid", required: false };
    expect(reasons(fk("User"), fk("User"), renames)).toEqual([]);
    expect(reasons(plain, plain, renames)).toEqual([]);
  });
});
