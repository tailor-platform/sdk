import { Decimal } from "decimal.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { withDecimal } from "./decimal-client";
import { createGetDB } from "./index";
import type { TailordbClientInstance, TailordbQueryResult } from "#/runtime/index";

type QueryCall = { sql: string; args: readonly unknown[] | undefined };

function stubClient(
  respond: (call: QueryCall) => Partial<TailordbQueryResult<unknown>>,
): TailordbClientInstance & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  return {
    calls,
    connect: async () => {},
    end: async () => {},
    queryObject: async <O>(sql: string, args?: readonly unknown[]) => {
      const call = { sql, args };
      calls.push(call);
      return {
        command: "SELECT",
        rowCount: 0,
        rows: [],
        fields: [],
        ...respond(call),
      } as TailordbQueryResult<O>;
    },
  };
}

describe("withDecimal reading", () => {
  test("converts a numeric column found by its result name, whatever the SQL called it", async () => {
    const client = withDecimal(
      stubClient(() => ({
        rows: [{ p: "1.50", total: "3.00", name: "a" }],
        fields: [
          { name: "p", typeName: "numeric" },
          { name: "total", typeName: "numeric" },
          { name: "name", typeName: "text" },
        ],
      })),
      Decimal,
    );

    const { rows } = await client.queryObject<{ p: Decimal; total: Decimal; name: string }>("q");

    expect(Decimal.isDecimal(rows[0]?.p)).toBe(true);
    expect(rows[0]?.p.toFixed()).toBe("1.5");
    expect(rows[0]?.total.toFixed()).toBe("3");
    expect(rows[0]?.name).toBe("a");
  });

  test("leaves float8 and integer columns as numbers", async () => {
    const client = withDecimal(
      stubClient(() => ({
        rows: [{ len: 2.5, n: 3 }],
        fields: [
          { name: "len", typeName: "float8" },
          { name: "n", typeName: "int4" },
        ],
      })),
      Decimal,
    );

    expect((await client.queryObject("q")).rows).toEqual([{ len: 2.5, n: 3 }]);
  });

  test("converts each element of a numeric array and keeps nulls", async () => {
    const client = withDecimal(
      stubClient(() => ({
        rows: [{ prices: ["1.5", null, "2"], none: null }],
        fields: [
          { name: "prices", typeName: "_numeric" },
          { name: "none", typeName: "numeric" },
        ],
      })),
      Decimal,
    );

    const { rows } = await client.queryObject<{ prices: (Decimal | null)[]; none: null }>("q");

    expect(rows[0]?.prices.map((v) => v?.toFixed() ?? null)).toEqual(["1.5", null, "2"]);
    expect(rows[0]?.none).toBeNull();
  });

  test("accepts a result with no rows", async () => {
    const client = withDecimal(
      stubClient(() => ({ rows: [], fields: [{ name: "price", typeName: "numeric" }] })),
      Decimal,
    );

    expect((await client.queryObject("q")).rows).toEqual([]);
  });
});

describe("withDecimal writing", () => {
  async function sentArgs(args: unknown[]) {
    const stub = stubClient(() => ({ fields: [] }));
    await withDecimal(stub, Decimal).queryObject("q", args);
    return stub.calls[0]?.args;
  }

  test("sends a Decimal as plain-notation text, never an exponent", async () => {
    expect(
      await sentArgs([new Decimal("1e-7"), new Decimal("1e21"), new Decimal("-12.50")]),
    ).toEqual(["0.0000001", "1000000000000000000000", "-12.5"]);
  });

  test("converts Decimals inside arrays and plain objects and leaves other values alone", async () => {
    expect(
      await sentArgs([[new Decimal("1.5"), "x"], { price: new Decimal("2"), n: 1 }, null, "s", 3]),
    ).toEqual([["1.5", "x"], { price: "2", n: 1 }, null, "s", 3]);
  });

  test("rejects a Decimal the Platform cannot store", async () => {
    await expect(sentArgs([new Decimal(NaN)])).rejects.toThrow("finite");
    await expect(sentArgs([new Decimal("1e999999999")])).rejects.toThrow("out of range");
  });
});

describe("createGetDB with decimal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function installClient(respond: (call: QueryCall) => Partial<TailordbQueryResult<unknown>>) {
    const stub = stubClient(respond);
    class StubClient {
      constructor() {
        return stub;
      }
    }
    vi.stubGlobal("tailordb", { Client: StubClient });
    return stub;
  }

  type Database = { ns: { Item: { id: string; price: string } } };

  test("converts query parameters and results of a Kysely query", async () => {
    const stub = installClient(() => ({
      rows: [{ price: "9.99" }],
      fields: [{ name: "price", typeName: "numeric" }],
    }));
    const db = createGetDB<Database>({ decimal: Decimal })("ns");

    const rows = await db
      .selectFrom("Item")
      .select("price")
      .where("price", "=", new Decimal("9.99") as never)
      .execute();

    expect(stub.calls[0]?.args).toEqual(["9.99"]);
    expect(Decimal.isDecimal(rows[0]?.price)).toBe(true);
  });

  test("converts inside a transaction, whose begin and commit report no columns", async () => {
    const stub = installClient((call) => ({
      rows: call.sql.startsWith("select") ? [{ price: "1" }] : [],
      fields: call.sql.startsWith("select") ? [{ name: "price", typeName: "numeric" }] : [],
    }));
    const db = createGetDB<Database>({ decimal: Decimal })("ns");

    const rows = await db
      .transaction()
      .execute((trx) => trx.selectFrom("Item").select("price").execute());

    expect(stub.calls.map((c) => c.sql.split(" ")[0])).toEqual(["begin", "select", "commit"]);
    expect(Decimal.isDecimal(rows[0]?.price)).toBe(true);
  });

  test("leaves the client untouched when decimal is not given", async () => {
    installClient(() => ({ rows: [{ price: "9.99" }] }));
    const db = createGetDB<Database>()("ns");

    expect(await db.selectFrom("Item").select("price").execute()).toEqual([{ price: "9.99" }]);
  });
});
