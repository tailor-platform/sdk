import { describe, expect, test } from "vitest";
import { columnTypeOverrides } from "./overrides";
import type { DDLTableConfig } from "@tailor-platform/sdk/plugin";

function table(name: string, fields: DDLTableConfig["fields"]): DDLTableConfig {
  return { name, fields };
}

describe("columnTypeOverrides", () => {
  test("types an enum column as the union of its allowed values, keyed by table and column", () => {
    const overrides = columnTypeOverrides([
      table("Account", {
        role: { type: "enum", allowedValues: [{ value: "ADMIN" }, { value: "MEMBER" }] },
      }),
    ]);
    expect(overrides).toEqual({ "Account.role": "'ADMIN' | 'MEMBER'" });
  });

  test("types an array enum column as an array of the union", () => {
    const overrides = columnTypeOverrides([
      table("Doc", {
        roles: { type: "enum", array: true, allowedValues: [{ value: "A" }, { value: "B" }] },
      }),
    ]);
    expect(overrides).toEqual({ "Doc.roles": "('A' | 'B')[]" });
  });

  test("ignores the value descriptions", () => {
    const overrides = columnTypeOverrides([
      table("Account", {
        role: { type: "enum", allowedValues: [{ value: "ADMIN", description: "full access" }] },
      }),
    ]);
    expect(overrides).toEqual({ "Account.role": "'ADMIN'" });
  });

  test("escapes quotes and backslashes so a value cannot break out of its literal", () => {
    const overrides = columnTypeOverrides([
      table("Account", {
        kind: { type: "enum", allowedValues: [{ value: "it's" }, { value: "a\\b" }] },
      }),
    ]);
    expect(overrides).toEqual({ "Account.kind": "'it\\'s' | 'a\\\\b'" });
  });

  test("leaves columns that are not enums with allowed values to SafeQL", () => {
    const overrides = columnTypeOverrides([
      table("Account", {
        email: { type: "string" },
        plain: { type: "enum" },
        none: { type: "enum", allowedValues: [] },
      }),
    ]);
    expect(overrides).toEqual({});
  });

  test("keeps same-named columns of different tables apart", () => {
    const overrides = columnTypeOverrides([
      table("Order_Item", { status: { type: "enum", allowedValues: [{ value: "A" }] } }),
      table("Order", { Item_Status: { type: "enum", allowedValues: [{ value: "B" }] } }),
    ]);
    expect(overrides).toEqual({ "Order_Item.status": "'A'", "Order.Item_Status": "'B'" });
  });
});
