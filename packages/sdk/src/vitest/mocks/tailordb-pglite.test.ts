import { describe, expect, test, vi } from "vitest";
import { createGetDB } from "#/kysely/index";
import { tailordbRoot } from "./shared";
import { mockTailordbWithPGlite } from "./tailordb-pglite";
import type { PGliteClient, PGliteQueryResult } from "../pglite-kysely";

interface Namespaces {
  main: {
    User: { id: string; email: string | null };
  };
  sub: {
    Item: { id: string };
  };
}

const getDB = createGetDB<Namespaces>();

interface RecordedQuery {
  query: string;
  params: unknown[];
}

type FakeResponder = (query: string, params: unknown[]) => Partial<PGliteQueryResult> | undefined;

function createFakePGlite(respond?: FakeResponder) {
  const queries: RecordedQuery[] = [];
  let closed = false;
  const client: PGliteClient = {
    query: async (query, params) => {
      queries.push({ query, params: params ?? [] });
      const head = query.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? "";
      const base: PGliteQueryResult = { rows: [], command: head, rowCount: 0, affectedRows: 0 };
      return { ...base, ...respond?.(query, params ?? []) };
    },
    close: async () => {
      closed = true;
    },
  };
  return { client, queries, isClosed: () => closed };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

describe("mockTailordbWithPGlite", () => {
  test("getDB runs its production path against the registered instance", async () => {
    const fake = createFakePGlite((query) =>
      query.startsWith("select")
        ? { rows: [{ id: "u-1", email: null }], command: "SELECT", rowCount: 1 }
        : undefined,
    );
    using mock = mockTailordbWithPGlite({ namespaces: { main: fake.client } });

    const db = getDB("main");
    const rows = await db
      .selectFrom("User")
      .selectAll()
      .where("email", "=", "a@example.com")
      .execute();

    expect(rows).toEqual([{ id: "u-1", email: null }]);
    expect(fake.queries).toEqual([
      { query: 'select * from "User" where "email" = $1', params: ["a@example.com"] },
    ]);
    expect(mock.executedQueries).toEqual([
      {
        namespace: "main",
        query: 'select * from "User" where "email" = $1',
        params: ["a@example.com"],
      },
    ]);
  });

  test("maps the PGlite command tag and rowCount to numAffectedRows", async () => {
    const fake = createFakePGlite((query) =>
      query.startsWith("update") ? { rows: [], command: "UPDATE", rowCount: 3 } : undefined,
    );
    using _mock = mockTailordbWithPGlite({ namespaces: { main: fake.client } });

    const result = await getDB("main").updateTable("User").set({ email: null }).executeTakeFirst();

    expect(result.numUpdatedRows).toBe(3n);
  });

  test("falls back to affectedRows when the client result has no command tag", async () => {
    const fake = createFakePGlite((query) =>
      query.startsWith("delete")
        ? { rows: [], command: undefined, rowCount: undefined, affectedRows: 2 }
        : undefined,
    );
    using _mock = mockTailordbWithPGlite({ namespaces: { main: fake.client } });

    const result = await getDB("main").deleteFrom("User").executeTakeFirst();

    expect(result.numDeletedRows).toBe(2n);
  });

  test("routes each namespace to its own instance", async () => {
    const main = createFakePGlite();
    const sub = createFakePGlite();
    using _mock = mockTailordbWithPGlite({
      namespaces: { main: main.client, sub: sub.client },
    });

    await getDB("main").selectFrom("User").selectAll().execute();
    await getDB("sub").selectFrom("Item").selectAll().execute();

    expect(main.queries).toHaveLength(1);
    expect(sub.queries).toHaveLength(1);
    expect(sub.queries[0]?.query).toContain('"Item"');
  });

  test("rejects a namespace with no registered instance", () => {
    const fake = createFakePGlite();
    using _mock = mockTailordbWithPGlite({ namespaces: { main: fake.client } });

    expect(() => getDB("sub").selectFrom("Item")).toThrow(/no PGlite instance registered.*"sub"/);
  });

  test("serializes transactions from different getDB instances on one shared instance", async () => {
    const fake = createFakePGlite();
    using _mock = mockTailordbWithPGlite({ namespaces: { main: fake.client } });
    const db1 = getDB("main");
    const db2 = getDB("main");

    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => (releaseFirst = resolve));

    const first = db1.transaction().execute(async (trx) => {
      await trx.selectFrom("User").selectAll().execute();
      await holdFirst;
    });
    await vi.waitFor(() => {
      expect(fake.queries.some((q) => q.query === "begin")).toBe(true);
    });

    const second = db2.transaction().execute(async (trx) => {
      await trx.selectFrom("User").selectAll().execute();
    });
    await tick();
    expect(fake.queries.filter((q) => q.query === "begin")).toHaveLength(1);

    releaseFirst();
    await Promise.all([first, second]);

    expect(fake.queries.map((q) => q.query)).toEqual([
      "begin",
      'select * from "User"',
      "commit",
      "begin",
      'select * from "User"',
      "commit",
    ]);
  });

  test("makes a plain query from another getDB instance wait for an open transaction", async () => {
    const fake = createFakePGlite();
    using _mock = mockTailordbWithPGlite({ namespaces: { main: fake.client } });
    const db1 = getDB("main");
    const db2 = getDB("main");

    let releaseTx!: () => void;
    const holdTx = new Promise<void>((resolve) => (releaseTx = resolve));

    const tx = db1.transaction().execute(async (trx) => {
      await trx.selectFrom("User").selectAll().execute();
      await holdTx;
    });
    await vi.waitFor(() => {
      expect(fake.queries.some((q) => q.query === "begin")).toBe(true);
    });

    const plain = db2.selectFrom("User").selectAll().execute();
    await tick();
    expect(fake.queries.map((q) => q.query)).toEqual(["begin", 'select * from "User"']);

    releaseTx();
    await Promise.all([tx, plain]);
    expect(fake.queries.map((q) => q.query)).toEqual([
      "begin",
      'select * from "User"',
      "commit",
      'select * from "User"',
    ]);
  });

  test("lets queries inside the transaction run while it is open", async () => {
    const fake = createFakePGlite();
    using _mock = mockTailordbWithPGlite({ namespaces: { main: fake.client } });

    await getDB("main")
      .transaction()
      .execute(async (trx) => {
        await trx.selectFrom("User").selectAll().execute();
        await trx.selectFrom("User").selectAll().execute();
      });

    expect(fake.queries.map((q) => q.query)).toEqual([
      "begin",
      'select * from "User"',
      'select * from "User"',
      "commit",
    ]);
  });

  test("releases the lock when the transaction rolls back", async () => {
    const fake = createFakePGlite();
    using _mock = mockTailordbWithPGlite({ namespaces: { main: fake.client } });
    const db = getDB("main");

    await expect(
      db.transaction().execute(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await db.selectFrom("User").selectAll().execute();
    expect(fake.queries.map((q) => q.query)).toEqual(["begin", "rollback", 'select * from "User"']);
  });

  test("end() stops the client without closing the PGlite instance", async () => {
    const fake = createFakePGlite();
    using mock = mockTailordbWithPGlite({ namespaces: { main: fake.client } });

    const db = getDB("main");
    await db.selectFrom("User").selectAll().execute();
    await db.destroy();
    expect(fake.isClosed()).toBe(false);
    expect(mock.createdClients).toEqual([{ namespace: "main", ended: true }]);

    const root = tailordbRoot();
    const client = new root.Client({ namespace: "main" });
    await client.end();
    await expect(client.queryObject("select 1", [])).rejects.toThrow(/end\(\)/);
    expect(fake.isClosed()).toBe(false);
  });

  test("records created clients per namespace", async () => {
    const main = createFakePGlite();
    const sub = createFakePGlite();
    using mock = mockTailordbWithPGlite({
      namespaces: { main: main.client, sub: sub.client },
    });

    getDB("main");
    getDB("sub");

    expect(mock.createdClients).toEqual([
      { namespace: "main", ended: false },
      { namespace: "sub", ended: false },
    ]);
    expect(mock.Client).toHaveBeenCalledTimes(2);
  });

  test("clear() drops recorded queries and clients but keeps the mock installed", async () => {
    const fake = createFakePGlite();
    using mock = mockTailordbWithPGlite({ namespaces: { main: fake.client } });

    await getDB("main").selectFrom("User").selectAll().execute();
    mock.clear();

    expect(mock.executedQueries).toEqual([]);
    expect(mock.createdClients).toEqual([]);
    await getDB("main").selectFrom("User").selectAll().execute();
    expect(mock.executedQueries).toHaveLength(1);
  });

  test("restores the previous Client on dispose (LIFO nesting)", () => {
    const root = tailordbRoot();
    const sentinel = function SentinelClient() {};
    const prev = root.Client;
    root.Client = sentinel;
    try {
      const outer = createFakePGlite();
      const inner = createFakePGlite();
      {
        using _outer = mockTailordbWithPGlite({ namespaces: { main: outer.client } });
        const installedOuter = root.Client;
        {
          using _inner = mockTailordbWithPGlite({ namespaces: { main: inner.client } });
          expect(root.Client).not.toBe(installedOuter);
        }
        expect(root.Client).toBe(installedOuter);
      }
      expect(root.Client).toBe(sentinel);
    } finally {
      root.Client = prev;
    }
  });

  test("rollback to a savepoint does not release the transaction lock", async () => {
    const fake = createFakePGlite();
    using _mock = mockTailordbWithPGlite({ namespaces: { main: fake.client } });
    const root = tailordbRoot();
    const c1 = new root.Client({ namespace: "main" });
    const c2 = new root.Client({ namespace: "main" });

    await c1.queryObject("begin", []);
    await c1.queryObject("rollback to savepoint s1", []);
    await c1.queryObject("rollback transaction to savepoint s1", []);
    await c1.queryObject("rollback work to s1", []);

    let done = false;
    const pending = c2.queryObject("select 1", []).then(() => {
      done = true;
    });
    await tick();
    expect(done).toBe(false);

    await c1.queryObject("commit", []);
    await pending;
    expect(done).toBe(true);
  });

  test("end() releases a lock left held by an open transaction", async () => {
    const fake = createFakePGlite();
    using _mock = mockTailordbWithPGlite({ namespaces: { main: fake.client } });
    const root = tailordbRoot();
    const c1 = new root.Client({ namespace: "main" });
    const c2 = new root.Client({ namespace: "main" });

    await c1.queryObject("begin", []);
    await c1.end();

    await c2.queryObject("select 1", []);
    expect(fake.queries.map((q) => q.query)).toEqual(["begin", "select 1"]);
  });

  test("createTransaction on the raw client drives begin/commit through the same lock", async () => {
    const fake = createFakePGlite();
    using _mock = mockTailordbWithPGlite({ namespaces: { main: fake.client } });

    const root = tailordbRoot();
    const client = new root.Client({ namespace: "main" });
    const txn = client.createTransaction("t");
    await txn.begin();
    await txn.queryObject("select 1", []);
    await txn.commit();

    expect(fake.queries.map((q) => q.query)).toEqual(["begin", "select 1", "commit"]);
  });
});
