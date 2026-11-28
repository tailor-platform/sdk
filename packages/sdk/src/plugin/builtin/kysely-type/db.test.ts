import { Decimal } from "decimal.js";
import { afterEach, describe, expect, test, vi } from "vitest";

const GATE = "__TAILOR_PLATFORM_BUNDLE_KYSELY_TEMPORAL";
const DECIMAL_GATE = "__TAILOR_PLATFORM_BUNDLE_KYSELY_DECIMAL";

type Gates = { temporal?: string; decimal?: string };

async function getDBWith(gates: Gates) {
  vi.resetModules();
  const queryObject = vi.fn(async () => ({
    command: "SELECT",
    rowCount: 1,
    rows: [{ price: "1.5" }],
    fields: [{ name: "price", typeName: "numeric" }],
  }));
  const Client = vi.fn(function () {
    return { connect: async () => {}, end: async () => {}, queryObject };
  });
  vi.stubGlobal("tailordb", { Client });
  vi.stubEnv(GATE, gates.temporal);
  vi.stubEnv(DECIMAL_GATE, gates.decimal);
  const { getDB } = await import("./db");
  // `getDB` is typed for a namespace map the project's `.tailor` file declares.
  const db = (getDB as (namespace: string) => unknown)("main") as {
    selectFrom(table: string): { select(column: string): { execute(): Promise<unknown[]> } };
  };
  return { Client, rows: await db.selectFrom("Item").select("price").execute() };
}

describe("getDB", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("reads Temporal values when the bundle gate says the plugin is configured with temporal", async () => {
    expect((await getDBWith({ temporal: "true" })).Client).toHaveBeenCalledWith({
      namespace: "main",
      temporal: true,
    });
  });

  test("reads Date and string values when the gate is absent", async () => {
    expect((await getDBWith({})).Client).toHaveBeenCalledWith({ namespace: "main" });
  });

  test("reads Decimal values when the bundle gate says the plugin is configured with decimal", async () => {
    const { rows } = await getDBWith({ decimal: "true" });

    expect(Decimal.isDecimal((rows[0] as { price: unknown }).price)).toBe(true);
  });

  test("reads decimal columns as strings when the decimal gate is absent", async () => {
    expect((await getDBWith({})).rows).toEqual([{ price: "1.5" }]);
  });
});

describe("createScopedGetDB", () => {
  test("returns getDB itself, which the type argument only narrows", async () => {
    vi.resetModules();
    const { createScopedGetDB, getDB } = await import("./db");

    expect(createScopedGetDB()).toBe(getDB);
  });
});
