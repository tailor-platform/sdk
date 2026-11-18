import { describe, expect, test } from "vitest";
import { collectBreakingFieldChanges } from "./field-change-rules";
import type { SnapshotFieldConfig } from "./snapshot-types";

describe("collectBreakingFieldChanges: foreign key retargets", () => {
  const fk = (target: string, field?: string): SnapshotFieldConfig => ({
    type: "uuid",
    required: false,
    foreignKey: true,
    foreignKeyType: target,
    ...(field !== undefined && { foreignKeyField: field }),
  });
  const renames = new Map([["User", "Person"]]);
  const reasons = (
    before: SnapshotFieldConfig,
    after: SnapshotFieldConfig,
    typeRenameTargets?: ReadonlyMap<string, string>,
  ) =>
    collectBreakingFieldChanges(
      { tableName: "Order", fieldName: "ownerId" },
      { before, after, nestedMember: false, typeRenameTargets },
    ).map(({ reason }) => reason);

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
    expect(reasons(fk("User"), fk("User"), renames)).toEqual([]);
  });
});
