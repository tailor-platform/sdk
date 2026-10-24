import { describe, expect, test } from "vitest";
import { collectForeignKeyReferences, collectForeignKeyTargets } from "./foreign-key-targets";

describe("collectForeignKeyTargets", () => {
  test("lists the tables that top-level fields point at, once each", () => {
    expect(
      collectForeignKeyTargets({
        ownerID: { foreignKeyType: "User" },
        creatorID: { foreignKeyType: "User" },
        productID: { foreignKeyType: "Product" },
        name: {},
      }),
    ).toEqual(["User", "Product"]);
  });

  test("includes the tables that fields inside a nested field point at", () => {
    expect(
      collectForeignKeyTargets({
        ownerID: { foreignKeyType: "User" },
        info: { fields: { managerID: { foreignKeyType: "Manager" } } },
      }),
    ).toEqual(["User", "Manager"]);
  });

  test("includes the tables that fields inside a nested array point at", () => {
    expect(
      collectForeignKeyTargets({
        lines: { fields: { assigneeID: { foreignKeyType: "User" } } },
      }),
    ).toEqual(["User"]);
  });
});

describe("collectForeignKeyReferences", () => {
  test("keeps the referenced field of a reference inside a nested field", () => {
    expect(
      collectForeignKeyReferences({
        ownerID: { foreignKeyType: "User" },
        info: { fields: { ownerCode: { foreignKeyType: "User", foreignKeyField: "code" } } },
      }),
    ).toEqual([
      { table: "User", path: "ownerID" },
      { table: "User", field: "code", path: "info.ownerCode" },
    ]);
  });

  test("names each reference by its dotted path through nested fields", () => {
    expect(
      collectForeignKeyReferences({
        a: { fields: { b: { fields: { parentID: { foreignKeyType: "Node" } } } } },
      }).map((reference) => reference.path),
    ).toEqual(["a.b.parentID"]);
  });
});
