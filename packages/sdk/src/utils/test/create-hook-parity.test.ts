import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { buildTableScripts } from "./internal";
import { createTailorDBHook } from "./index";

const now = new Date("2026-04-15T01:02:03.004Z");

type TableHookArgs = { input: object };

// Deployed scripts embed hooks by their source, so this must not reference outer bindings.
const describeInput = (args: TableHookArgs) => ({
  info: JSON.stringify(
    Object.entries(args.input)
      .map(
        ([key, value]) =>
          `${key}:${value instanceof Date ? "Date" : value === null ? "null" : typeof value}`,
      )
      .toSorted(),
  ),
});

const order = db
  .table("Order", {
    title: db.string(),
    note: db.string({ optional: true }),
    givenAt: db.datetime({ optional: true }),
    stampedAt: db.datetime({ optional: true }).hooks({ create: ({ now }) => now }),
    createdAt: db.datetime().default("now"),
    day: db.date().default("now"),
    at: db.time().default("now"),
    status: db.string().default("active"),
    slug: db.string({ optional: true }).hooks({ create: ({ input }) => input?.trim() ?? null }),
    address: db.object({ city: db.string() }, { optional: true }),
    lines: db.object({ sku: db.string() }, { array: true, optional: true }),
    info: db.string({ optional: true }),
  })
  .hooks({ create: describeInput });

const memo = db
  .table("Memo", {
    title: db.string(),
    note: db.string({ optional: true }),
    givenAt: db.datetime({ optional: true }),
    info: db.string({ optional: true }),
  })
  .hooks({ create: describeInput });

const stamp = db.table("Stamp", {
  title: db.string(),
  stampedAt: db.datetime({ optional: true }).hooks({ create: ({ now }) => now }),
  createdAt: db.datetime().default("now"),
  day: db.date().default("now"),
  at: db.time().default("now"),
  status: db.string().default("active"),
});

type Table = typeof order | typeof memo | typeof stamp;

// The Platform merges the script's result onto the create input.
function deployedCreate(table: Table, row: Record<string, unknown>) {
  const expr = buildTableScripts(table).typeHook?.create?.expr;
  if (!expr) {
    throw new Error(`${table.name} has no create hook script`);
  }
  const result: unknown = new Function("_input", "_oldRecord", "user", `return ${expr}`)(
    row,
    null,
    null,
  );
  return { ...row, ...(result as object) };
}

// Each side assigns its own id to a row without one.
function stored(record: object, row: Record<string, unknown>) {
  const { id, ...rest } = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  return Object.hasOwn(row, "id") ? { id, ...rest } : rest;
}

describe("createTailorDBHook matches the deployed create hook", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test.each<[string, Table, Record<string, unknown>]>([
    ["only required fields", order, { title: "a" }],
    [
      "an id, an explicit null, and a given datetime",
      order,
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "b",
        note: null,
        givenAt: "2026-01-02T03:04:05.000Z",
      },
    ],
    [
      "values for hooked, defaulted, and nested fields",
      order,
      {
        title: "c",
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "closed",
        slug: "  s  ",
        address: { city: "Tokyo" },
        lines: [{ sku: "x" }],
      },
    ],
    ["only required fields on a table with only a table hook", memo, { title: "a" }],
    [
      "an id on a table with only a table hook",
      memo,
      { id: "22222222-2222-4222-8222-222222222222", title: "b", note: null },
    ],
    ["only required fields on a table without a table hook", stamp, { title: "a" }],
  ])("%s", (_label, table, row) => {
    expect(stored(createTailorDBHook(table)(row, now), row)).toEqual(
      stored(deployedCreate(table, row), row),
    );
  });
});
