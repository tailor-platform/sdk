import { describe, expect, test } from "vitest";
import { createKyselyPGlite, type PGliteClient } from "./pglite-kysely";

interface Database {
  User: {
    id: string;
    email: string | null;
  };
}

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function createStubClient(rows: unknown[] = [], affectedRows?: number) {
  const queries: RecordedQuery[] = [];
  let closed = false;
  const client: PGliteClient = {
    query: (sql, params) => {
      queries.push({ sql, params: params ?? [] });
      return Promise.resolve({ rows, affectedRows });
    },
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  };
  return { client, queries, isClosed: () => closed };
}

describe("createKyselyPGlite", () => {
  test("compiles queries with Postgres placeholders and passes parameters", async () => {
    const { client, queries } = createStubClient([{ id: "1", email: null }]);
    const db = createKyselyPGlite<Database>(client);

    const rows = await db
      .selectFrom("User")
      .selectAll()
      .where("email", "=", "a@example.com")
      .execute();

    expect(rows).toEqual([{ id: "1", email: null }]);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toBe('select * from "User" where "email" = $1');
    expect(queries[0]?.params).toEqual(["a@example.com"]);
  });

  test("reports affected rows from updates", async () => {
    const { client } = createStubClient([], 3);
    const db = createKyselyPGlite<Database>(client);

    const result = await db
      .updateTable("User")
      .set({ email: "unknown@example.com" })
      .where("email", "is", null)
      .executeTakeFirst();

    expect(result.numUpdatedRows).toBe(3n);
  });

  test("wraps transactions in begin/commit", async () => {
    const { client, queries } = createStubClient();
    const db = createKyselyPGlite<Database>(client);

    await db.transaction().execute(async (trx) => {
      await trx.updateTable("User").set({ email: "x@example.com" }).execute();
    });

    expect(queries.map((q) => q.sql)).toEqual([
      "begin",
      'update "User" set "email" = $1',
      "commit",
    ]);
  });

  test("rolls back the transaction when the callback throws", async () => {
    const { client, queries } = createStubClient();
    const db = createKyselyPGlite<Database>(client);

    await expect(
      db.transaction().execute(async (trx) => {
        await trx.updateTable("User").set({ email: "x@example.com" }).execute();
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(queries.map((q) => q.sql)).toEqual([
      "begin",
      'update "User" set "email" = $1',
      "rollback",
    ]);
  });

  test("applies the configured isolation level", async () => {
    const { client, queries } = createStubClient();
    const db = createKyselyPGlite<Database>(client);

    await db
      .transaction()
      .setIsolationLevel("serializable")
      .execute(async (trx) => {
        await trx.selectFrom("User").selectAll().execute();
      });

    expect(queries[0]?.sql).toBe("start transaction isolation level serializable");
  });

  test("destroy closes the client", async () => {
    const { client, isClosed } = createStubClient();
    const db = createKyselyPGlite<Database>(client);
    await db.selectFrom("User").selectAll().execute();

    await db.destroy();

    expect(isClosed()).toBe(true);
  });
});
