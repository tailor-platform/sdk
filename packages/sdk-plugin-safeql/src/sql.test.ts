import { describe, expect, test, vi } from "vitest";
import { sql, type QueryExecutor } from "./sql";

function executorReturning(rows: unknown[] | undefined) {
  const queryObject = vi.fn(async () => ({ rows }));
  return { queryObject } satisfies QueryExecutor;
}

describe("sql", () => {
  test("numbers interpolated values as $1, $2 in order of appearance", () => {
    const minimumAge = 18;
    const role = "ADMIN";
    const query = sql`SELECT "email" FROM "Account" WHERE "age" >= ${minimumAge} AND "role" = ${role}`;
    expect(query.text).toBe(`SELECT "email" FROM "Account" WHERE "age" >= $1 AND "role" = $2`);
    expect(query.values).toEqual([18, "ADMIN"]);
  });

  test("leaves a statement without interpolations untouched and has no values", () => {
    const query = sql`SELECT 1`;
    expect(query.text).toBe("SELECT 1");
    expect(query.values).toEqual([]);
  });

  test("keeps interpolated text out of the statement so it cannot alter the SQL", () => {
    const hostile = `'; DROP TABLE "Account"; --`;
    const query = sql`SELECT "email" FROM "Account" WHERE "email" = ${hostile}`;
    expect(query.text).not.toContain("DROP");
    expect(query.values).toEqual([hostile]);
  });

  describe("execute", () => {
    test("sends the statement and its values to the executor's queryObject", async () => {
      const executor = executorReturning([]);
      await sql`SELECT "email" FROM "Account" WHERE "age" >= ${18}`.execute(executor);
      expect(executor.queryObject).toHaveBeenCalledExactlyOnceWith(
        `SELECT "email" FROM "Account" WHERE "age" >= $1`,
        [18],
      );
    });

    test("resolves to the rows the executor returned", async () => {
      const rows = [{ email: "a@example.com" }];
      expect(
        await sql<{ email: string }>`SELECT "email" FROM "Account"`.execute(
          executorReturning(rows),
        ),
      ).toEqual(rows);
    });

    test("resolves to an empty array when the result carries no rows", async () => {
      expect(
        await sql`UPDATE "Account" SET "age" = 1`.execute(executorReturning(undefined)),
      ).toEqual([]);
    });
  });
});
