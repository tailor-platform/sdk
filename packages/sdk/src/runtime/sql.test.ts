import { describe, expect, test, vi } from "vitest";
import { createSqlQuery, type SqlCardinality, type SqlClient } from "./sql";

function client(rows: unknown[]) {
  const queryObject = vi.fn(async () => ({ rows }));
  return { queryObject, client: { queryObject } as unknown as SqlClient };
}

const definition = { namespace: "main", sql: 'SELECT "id" FROM "Order"' };

function query(cardinality: SqlCardinality) {
  return createSqlQuery<Record<never, never>, { id: string }, typeof cardinality>({
    ...definition,
    paramNames: [],
    cardinality,
  });
}

describe("createSqlQuery", () => {
  test("binds each placeholder by name, in order, repeating a name used twice", async () => {
    const { client: db, queryObject } = client([]);
    const withParams = createSqlQuery<{ status: string; min: number }, { id: string }, "many">({
      ...definition,
      paramNames: ["status", "min", "status"],
      cardinality: "many",
    });

    await withParams.run(db, { status: "PAID", min: 3 });

    expect(queryObject).toHaveBeenCalledWith('SELECT "id" FROM "Order"', ["PAID", 3, "PAID"]);
  });

  test("returns every row for many", async () => {
    await expect(query("many").run(client([{ id: "a" }, { id: "b" }]).client)).resolves.toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });

  test("returns the row or null for maybeOne", async () => {
    await expect(query("maybeOne").run(client([{ id: "a" }]).client)).resolves.toEqual({ id: "a" });
    await expect(query("maybeOne").run(client([]).client)).resolves.toBeNull();
  });

  test("returns the row for one", async () => {
    await expect(query("one").run(client([{ id: "a" }]).client)).resolves.toEqual({ id: "a" });
  });

  test("returns nothing for none", async () => {
    await expect(query("none").run(client([]).client)).resolves.toBeUndefined();
  });

  test.each([
    { cardinality: "one" as const, rows: [] },
    { cardinality: "one" as const, rows: [{ id: "a" }, { id: "b" }] },
    { cardinality: "maybeOne" as const, rows: [{ id: "a" }, { id: "b" }] },
  ])("rejects $rows.length rows for $cardinality", async ({ cardinality, rows }) => {
    await expect(query(cardinality).run(client(rows).client)).rejects.toThrow(
      `The query in namespace "main" returned ${rows.length} rows; its type allows ${cardinality === "one" ? "exactly one" : "at most one"}`,
    );
  });

  test("exposes the namespace and the statement it sends", () => {
    expect(query("many")).toMatchObject({ namespace: "main", sql: 'SELECT "id" FROM "Order"' });
  });
});
