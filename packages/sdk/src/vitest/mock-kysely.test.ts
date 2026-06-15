import { describe, expect, test } from "vitest";
import { createKyselyMock } from "./mock-kysely";

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

describe("createKyselyMock", () => {
  test("returns staged rows for a select and records the compiled query", async () => {
    const mock = createKyselyMock<Database>();
    mock.enqueueResults([{ id: "1", email: "a@b.com", age: 30 }]);

    const row = await mock.db
      .selectFrom("User")
      .selectAll()
      .where("email", "=", "a@b.com")
      .executeTakeFirst();

    expect(row).toEqual({ id: "1", email: "a@b.com", age: 30 });
    expect(mock.selects).toHaveLength(1);
    expect(mock.executedQueries[0]!.kind).toBe("SelectQueryNode");
    expect(mock.executedQueries[0]!.sql).toContain('select * from "User" where "email" = $1');
    expect(mock.executedQueries[0]!.parameters).toEqual(["a@b.com"]);
  });

  test("records inserts with their parameters", async () => {
    const mock = createKyselyMock<Database>();
    mock.enqueueResults([{ id: "1", email: "a@b.com", age: 30 }]);

    const created = await mock.db
      .insertInto("User")
      .values({ id: "1", email: "a@b.com", age: 30 })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(created).toEqual({ id: "1", email: "a@b.com", age: 30 });
    expect(mock.inserts).toHaveLength(1);
    expect(mock.inserts[0]!.parameters).toEqual(["1", "a@b.com", 30]);
  });

  test("retains the compiled node on each recorded query", async () => {
    const mock = createKyselyMock<Database>();

    await mock.db.selectFrom("User").selectAll().execute();

    expect(mock.executedQueries[0]!.node.kind).toBe("SelectQueryNode");
  });

  test("reports staged numAffectedRows on a non-returning mutation", async () => {
    const mock = createKyselyMock<Database>();
    mock.enqueueResults({ numAffectedRows: 3 });

    const result = await mock.db
      .updateTable("User")
      .set({ age: 1 })
      .where("id", "=", "1")
      .executeTakeFirstOrThrow();

    expect(result.numUpdatedRows).toBe(3n);
  });

  test("defaults a non-returning mutation's affected count to zero when unstaged", async () => {
    const mock = createKyselyMock<Database>();

    const result = await mock.db.deleteFrom("User").where("id", "=", "1").executeTakeFirstOrThrow();

    expect(result.numDeletedRows).toBe(0n);
  });

  test("counts how many times each operation ran", async () => {
    const mock = createKyselyMock<Database>();

    await mock.db.insertInto("User").values({ id: "1", email: "a@b.com", age: 30 }).execute();
    await mock.db.insertInto("User").values({ id: "2", email: "c@d.com", age: 40 }).execute();
    await mock.db.updateTable("User").set({ age: 31 }).where("id", "=", "1").execute();

    expect(mock.inserts).toHaveLength(2);
    expect(mock.updates).toHaveLength(1);
    expect(mock.deletes).toHaveLength(0);
    expect(mock.executedQueries).toHaveLength(3);
  });

  test("does not record begin/commit when running inside a transaction", async () => {
    const mock = createKyselyMock<Database>();

    await mock.db.transaction().execute(async (trx) => {
      await trx.insertInto("User").values({ id: "1", email: "a@b.com", age: 30 }).execute();
      await trx.updateTable("User").set({ age: 31 }).where("id", "=", "1").execute();
    });

    expect(mock.inserts).toHaveLength(1);
    expect(mock.updates).toHaveLength(1);
    expect(mock.executedQueries).toHaveLength(2);
  });

  test("drains enqueued results in FIFO order across queries", async () => {
    const mock = createKyselyMock<Database>();
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
    const mock = createKyselyMock<Database>();
    mock.setQueryResolver((query) =>
      query.sql.includes('from "Post"') ? [{ id: "p1", userId: "1", title: "Hello" }] : [],
    );

    const post = await mock.db.selectFrom("Post").selectAll().executeTakeFirst();
    const user = await mock.db.selectFrom("User").selectAll().executeTakeFirst();

    expect(post).toMatchObject({ id: "p1" });
    expect(user).toBeUndefined();
  });

  test("reset clears recorded queries and staged results", async () => {
    const mock = createKyselyMock<Database>();
    mock.enqueueResults([{ id: "1", email: "a@b.com", age: 30 }]);
    await mock.db.selectFrom("User").selectAll().execute();

    mock.reset();

    expect(mock.executedQueries).toHaveLength(0);
    const rows = await mock.db.selectFrom("User").selectAll().execute();
    expect(rows).toEqual([]);
  });

  test("supports complex queries as a real Kysely instance", async () => {
    const mock = createKyselyMock<Database>();

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
    expect(mock.executedQueries[0]!.sql).toContain("left join");
    expect(mock.executedQueries[0]!.sql).toContain("group by");
  });

  describe("insertValues", () => {
    test("recovers the column -> value map for a single-row insert", async () => {
      const mock = createKyselyMock<Database>();

      await mock.db.insertInto("User").values({ id: "1", email: "a@b.com", age: 30 }).execute();

      expect(mock.inserts[0]!.insertValues()).toEqual({ id: "1", email: "a@b.com", age: 30 });
    });

    test("throws on a multi-row insert", async () => {
      const mock = createKyselyMock<Database>();

      await mock.db
        .insertInto("User")
        .values([
          { id: "1", email: "a@b.com", age: 30 },
          { id: "2", email: "c@d.com", age: 40 },
        ])
        .execute();

      expect(() => mock.inserts[0]!.insertValues()).toThrow(/inserts 2 rows/);
    });

    test("throws when given a non-insert query", async () => {
      const mock = createKyselyMock<Database>();

      await mock.db.selectFrom("User").selectAll().execute();

      expect(() => mock.selects[0]!.insertValues()).toThrow(/expected InsertQueryNode/);
    });
  });

  describe("insertRows", () => {
    test("recovers the column -> value map for every row of a multi-row insert", async () => {
      const mock = createKyselyMock<Database>();

      await mock.db
        .insertInto("User")
        .values([
          { id: "1", email: "a@b.com", age: 30 },
          { id: "2", email: "c@d.com", age: 40 },
        ])
        .execute();

      expect(mock.inserts[0]!.insertRows()).toEqual([
        { id: "1", email: "a@b.com", age: 30 },
        { id: "2", email: "c@d.com", age: 40 },
      ]);
    });

    test("throws on an unsupported insert shape instead of returning empty", async () => {
      const mock = createKyselyMock<Database>();

      await mock.db
        .insertInto("Post")
        .columns(["id", "userId", "title"])
        .expression((eb) => eb.selectFrom("User").select(["id", "id as userId", "email as title"]))
        .execute();

      expect(() => mock.inserts[0]!.insertRows()).toThrow(/unsupported insert shape/);
    });
  });

  describe("updateValues", () => {
    test("recovers the column -> value map from a SET clause", async () => {
      const mock = createKyselyMock<Database>();

      await mock.db.updateTable("User").set({ age: 31 }).where("id", "=", "1").execute();

      expect(mock.updates[0]!.updateValues()).toEqual({ age: 31 });
    });

    test("throws when given a non-update query", async () => {
      const mock = createKyselyMock<Database>();

      await mock.db.selectFrom("User").selectAll().execute();

      expect(() => mock.selects[0]!.updateValues()).toThrow(/expected UpdateQueryNode/);
    });
  });

  describe("withTx", () => {
    test("runs fn in a real transaction and records inner queries", async () => {
      const mock = createKyselyMock<Database>();
      mock.enqueueResults([{ id: "1", email: "a@b.com", age: 30 }]);

      const result = await mock.withTx(async (trx) => {
        expect(trx.isTransaction).toBe(true);
        return trx.selectFrom("User").selectAll().executeTakeFirst();
      });

      expect(result).toEqual({ id: "1", email: "a@b.com", age: 30 });
      // begin/commit are not recorded; only the select is.
      expect(mock.executedQueries).toHaveLength(1);
    });
  });
});
