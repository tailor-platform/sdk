import { describe, expect, test } from "vitest";
import { selectEntities } from "./entities";

const namespaceTables = {
  "main-db": ["User", "Order"],
  "sub-db": ["Event"],
};

describe("selectEntities", () => {
  test("processes everything when no filter is given", () => {
    const selection = selectEntities({
      namespaceTables,
      hasIdpUser: true,
      entities: [],
      skipIdp: false,
    });
    expect(selection.entitiesToProcess).toBeNull();
    expect(selection.hasEntitiesToProcess).toBe(true);
    expect(selection.warnings).toEqual([]);
  });

  test("reports when the resolved selection has no seed targets", () => {
    const empty = selectEntities({
      namespaceTables: {},
      hasIdpUser: false,
      entities: [],
      skipIdp: false,
    });
    expect(empty.hasEntitiesToProcess).toBe(false);

    const skippedIdp = selectEntities({
      namespaceTables: {},
      hasIdpUser: true,
      entities: [],
      skipIdp: true,
    });
    expect(skippedIdp.hasEntitiesToProcess).toBe(false);
  });

  test("rejects combining --namespace with entity names", () => {
    expect(() =>
      selectEntities({
        namespaceTables,
        hasIdpUser: false,
        namespace: "main-db",
        entities: ["User"],
        skipIdp: false,
      }),
    ).toThrow(/mutually exclusive/);
  });

  test("selects all tables of the given namespace", () => {
    const selection = selectEntities({
      namespaceTables,
      hasIdpUser: true,
      namespace: "main-db",
      entities: [],
      skipIdp: false,
    });
    expect(selection.entitiesToProcess).toEqual(["User", "Order"]);
  });

  test("rejects an unknown namespace with available names", () => {
    expect(() =>
      selectEntities({
        namespaceTables,
        hasIdpUser: false,
        namespace: "nope",
        entities: [],
        skipIdp: false,
      }),
    ).toThrow(/Available namespaces: main-db, sub-db/);
  });

  test("accepts _User as an entity only when the config has an IdP user", () => {
    const selection = selectEntities({
      namespaceTables,
      hasIdpUser: true,
      entities: ["_User", "User"],
      skipIdp: false,
    });
    expect(selection.entitiesToProcess).toEqual(["_User", "User"]);

    expect(() =>
      selectEntities({
        namespaceTables,
        hasIdpUser: false,
        entities: ["_User"],
        skipIdp: false,
      }),
    ).toThrow(/entities were not found: _User/);
  });

  test("--skip-idp removes _User from the selection", () => {
    const explicit = selectEntities({
      namespaceTables,
      hasIdpUser: true,
      entities: ["_User", "User"],
      skipIdp: true,
    });
    expect(explicit.entitiesToProcess).toEqual(["User"]);

    const all = selectEntities({
      namespaceTables,
      hasIdpUser: true,
      entities: [],
      skipIdp: true,
    });
    expect(all.entitiesToProcess).toEqual(["User", "Order", "Event"]);
  });

  test("warns that --skip-idp is redundant with --namespace", () => {
    const selection = selectEntities({
      namespaceTables,
      hasIdpUser: true,
      namespace: "main-db",
      entities: [],
      skipIdp: true,
    });
    expect(selection.warnings).toEqual([
      expect.stringContaining("--skip-idp is redundant with --namespace"),
    ]);
    expect(selection.entitiesToProcess).toEqual(["User", "Order"]);
  });
});
