import { describe, expect, test } from "vitest";
import { selectEntities } from "./entities";

const namespaceEntities = {
  "main-db": ["User", "Order"],
  "sub-db": ["Event"],
};

describe("selectEntities", () => {
  test("processes everything when no filter is given", () => {
    const selection = selectEntities({
      namespaceEntities,
      hasIdpUser: true,
      types: [],
      skipIdp: false,
    });
    expect(selection.entitiesToProcess).toBeNull();
    expect(selection.warnings).toEqual([]);
  });

  test("rejects combining --namespace with type names", () => {
    expect(() =>
      selectEntities({
        namespaceEntities,
        hasIdpUser: false,
        namespace: "main-db",
        types: ["User"],
        skipIdp: false,
      }),
    ).toThrow(/mutually exclusive/);
  });

  test("selects all types of the given namespace", () => {
    const selection = selectEntities({
      namespaceEntities,
      hasIdpUser: true,
      namespace: "main-db",
      types: [],
      skipIdp: false,
    });
    expect(selection.entitiesToProcess).toEqual(["User", "Order"]);
  });

  test("rejects an unknown namespace with available names", () => {
    expect(() =>
      selectEntities({
        namespaceEntities,
        hasIdpUser: false,
        namespace: "nope",
        types: [],
        skipIdp: false,
      }),
    ).toThrow(/Available namespaces: main-db, sub-db/);
  });

  test("accepts _User as a type only when the config has an IdP user", () => {
    const selection = selectEntities({
      namespaceEntities,
      hasIdpUser: true,
      types: ["_User", "User"],
      skipIdp: false,
    });
    expect(selection.entitiesToProcess).toEqual(["_User", "User"]);

    expect(() =>
      selectEntities({
        namespaceEntities,
        hasIdpUser: false,
        types: ["_User"],
        skipIdp: false,
      }),
    ).toThrow(/types were not found: _User/);
  });

  test("--skip-idp removes _User from the selection", () => {
    const explicit = selectEntities({
      namespaceEntities,
      hasIdpUser: true,
      types: ["_User", "User"],
      skipIdp: true,
    });
    expect(explicit.entitiesToProcess).toEqual(["User"]);

    const all = selectEntities({
      namespaceEntities,
      hasIdpUser: true,
      types: [],
      skipIdp: true,
    });
    expect(all.entitiesToProcess).toEqual(["User", "Order", "Event"]);
  });

  test("warns that --skip-idp is redundant with --namespace", () => {
    const selection = selectEntities({
      namespaceEntities,
      hasIdpUser: true,
      namespace: "main-db",
      types: [],
      skipIdp: true,
    });
    expect(selection.warnings).toEqual([
      expect.stringContaining("--skip-idp is redundant with --namespace"),
    ]);
    expect(selection.entitiesToProcess).toEqual(["User", "Order"]);
  });
});
