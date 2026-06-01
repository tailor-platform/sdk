import { describe, expect, test } from "vitest";
import { createMockKysely } from "./mock-kysely";

interface Database {
  User: {
    id: string;
    email: string;
    age: number;
  };
  Post: {
    id: string;
    userId: string;
    title: string;
  };
}

describe("createMockKysely", () => {
  test("returns staged rows for a select and records the compiled query", async () => {
    const mock = createMockKysely<Database>();
    mock.enqueueResults([{ id: "1", email: "a@b.com", age: 30 }]);

    const row = await mock.db
      .selectFrom("User")
      .selectAll()
      .where("email", "=", "a@b.com")
      .executeTakeFirst();

    expect(row).toEqual({ id: "1", email: "a@b.com", age: 30 });
    expect(mock.selects).toHaveLength(1);
    expect(mock.executedQueries[0].kind).toBe("SelectQueryNode");
    expect(mock.executedQueries[0].sql).toContain('select * from "User" where "email" = $1');
    expect(mock.executedQueries[0].parameters).toEqual(["a@b.com"]);
  });

  test("records inserts with their parameters", async () => {
    const mock = createMockKysely<Database>();
    mock.enqueueResults([{ id: "1", email: "a@b.com", age: 30 }]);

    const created = await mock.db
      .insertInto("User")
      .values({ id: "1", email: "a@b.com", age: 30 })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(created).toEqual({ id: "1", email: "a@b.com", age: 30 });
    expect(mock.inserts).toHaveLength(1);
    expect(mock.inserts[0].parameters).toEqual(["1", "a@b.com", 30]);
  });

  test("counts how many times each operation ran", async () => {
    const mock = createMockKysely<Database>();

    await mock.db.insertInto("User").values({ id: "1", email: "a@b.com", age: 30 }).execute();
    await mock.db.insertInto("User").values({ id: "2", email: "c@d.com", age: 40 }).execute();
    await mock.db.updateTable("User").set({ age: 31 }).where("id", "=", "1").execute();

    expect(mock.inserts).toHaveLength(2);
    expect(mock.updates).toHaveLength(1);
    expect(mock.deletes).toHaveLength(0);
    expect(mock.executedQueries).toHaveLength(3);
  });

  test("does not record begin/commit when running inside a transaction", async () => {
    const mock = createMockKysely<Database>();

    await mock.db.transaction().execute(async (trx) => {
      await trx.insertInto("User").values({ id: "1", email: "a@b.com", age: 30 }).execute();
      await trx.updateTable("User").set({ age: 31 }).where("id", "=", "1").execute();
    });

    expect(mock.inserts).toHaveLength(1);
    expect(mock.updates).toHaveLength(1);
    expect(mock.executedQueries).toHaveLength(2);
  });

  test("exposes the instance as a Transaction for code that receives one directly", async () => {
    const mock = createMockKysely<Database>();

    // Mirrors `command(trx, input)` style code that takes a Transaction<DB>.
    const insertUser = (trx: typeof mock.trx) =>
      trx.insertInto("User").values({ id: "1", email: "a@b.com", age: 30 }).execute();

    await insertUser(mock.trx);

    expect(mock.inserts).toHaveLength(1);
  });

  test("drains enqueued results in FIFO order across queries", async () => {
    const mock = createMockKysely<Database>();
    mock.enqueueResults(
      [{ id: "1", email: "a@b.com", age: 30 }],
      [{ id: "2", email: "c@d.com", age: 40 }],
    );

    const first = await mock.db.selectFrom("User").selectAll().executeTakeFirst();
    const second = await mock.db.selectFrom("User").selectAll().executeTakeFirst();

    expect(first).toMatchObject({ id: "1" });
    expect(second).toMatchObject({ id: "2" });
  });

  test("resolves results by inspecting the compiled query", async () => {
    const mock = createMockKysely<Database>();
    mock.setQueryResolver((query) =>
      query.sql.includes('from "Post"') ? [{ id: "p1", userId: "1", title: "Hello" }] : [],
    );

    const post = await mock.db.selectFrom("Post").selectAll().executeTakeFirst();
    const user = await mock.db.selectFrom("User").selectAll().executeTakeFirst();

    expect(post).toMatchObject({ id: "p1" });
    expect(user).toBeUndefined();
  });

  test("reset clears recorded queries and staged results", async () => {
    const mock = createMockKysely<Database>();
    mock.enqueueResults([{ id: "1", email: "a@b.com", age: 30 }]);
    await mock.db.selectFrom("User").selectAll().execute();

    mock.reset();

    expect(mock.executedQueries).toHaveLength(0);
    const rows = await mock.db.selectFrom("User").selectAll().execute();
    expect(rows).toEqual([]);
  });

  test("supports complex queries as a real Kysely instance", async () => {
    const mock = createMockKysely<Database>();

    await mock.db
      .selectFrom("User")
      .leftJoin("Post", "Post.userId", "User.id")
      .select(["User.id", "Post.title"])
      .where("User.age", ">", 18)
      .groupBy("User.id")
      .orderBy("User.id")
      .limit(10)
      .execute();

    expect(mock.selects).toHaveLength(1);
    expect(mock.executedQueries[0].sql).toContain("left join");
    expect(mock.executedQueries[0].sql).toContain("group by");
  });
});
