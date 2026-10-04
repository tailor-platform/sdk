import { describe, expect, test } from "vitest";
import { Temporal } from "#/runtime/temporal";
import { createKyselyPGlite, type PGliteClient, type PGliteQueryResult } from "./pglite-kysely";

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

function createStubClient(
  rows: unknown[] = [],
  affectedRows?: number,
  fields?: PGliteQueryResult["fields"],
) {
  const queries: RecordedQuery[] = [];
  let closed = false;
  const client: PGliteClient = {
    query: (sql, params) => {
      queries.push({ sql, params: params ?? [] });
      return Promise.resolve({ rows, affectedRows, fields });
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

interface TemporalDatabase {
  Event: {
    day: string | Temporal.PlainDate;
    at: Date | Temporal.Instant;
    time: string | Temporal.PlainTime;
    days: (string | Temporal.PlainDate | null)[];
  };
}

const DATE_OID = 1082;
const TIME_OID = 1083;
const TIMESTAMPTZ_OID = 1184;
const DATE_ARRAY_OID = 1182;

const eventFields = [
  { name: "day", dataTypeID: DATE_OID },
  { name: "at", dataTypeID: TIMESTAMPTZ_OID },
  { name: "time", dataTypeID: TIME_OID },
  { name: "days", dataTypeID: DATE_ARRAY_OID },
];

const pgliteEventRow = () => ({
  day: new Date("2026-03-14T00:00:00.000Z"),
  at: new Date("2026-03-14T09:30:00.123Z"),
  time: "09:30:15.5",
  days: [new Date("2026-03-14T00:00:00.000Z")],
});

describe("createKyselyPGlite Temporal support", () => {
  test("passes Temporal parameters to PGlite as the strings Postgres accepts", async () => {
    const { client, queries } = createStubClient();
    const db = createKyselyPGlite<TemporalDatabase>(client);

    await db
      .insertInto("Event")
      .values({
        day: Temporal.PlainDate.from("2026-03-14"),
        at: Temporal.Instant.from("2026-03-14T09:30:00.123Z"),
        time: Temporal.PlainTime.from("09:30:15"),
        days: [Temporal.PlainDate.from("2026-03-14")],
      })
      .execute();

    expect(queries[0]?.params).toEqual([
      "2026-03-14",
      "2026-03-14T09:30:00.123Z",
      "09:30",
      ["2026-03-14"],
    ]);
  });

  test("reads date, timestamptz, and time columns back as Temporal values when temporal is enabled", async () => {
    const { client } = createStubClient([pgliteEventRow()], undefined, eventFields);
    const db = createKyselyPGlite<TemporalDatabase>(client, { temporal: true });

    const row = await db.selectFrom("Event").selectAll().executeTakeFirstOrThrow();

    expect(row.day).toBeInstanceOf(Temporal.PlainDate);
    expect(row.day.toString()).toBe("2026-03-14");
    expect(row.at).toBeInstanceOf(Temporal.Instant);
    expect(row.at.toString()).toBe("2026-03-14T09:30:00.123Z");
    expect(row.time).toBeInstanceOf(Temporal.PlainTime);
    expect(row.time.toString()).toBe("09:30:00");
    expect(row.days.map((day) => day?.toString())).toEqual(["2026-03-14"]);
  });

  test("keeps the values PGlite returns when temporal is not enabled", async () => {
    const { client } = createStubClient([pgliteEventRow()], undefined, eventFields);
    const db = createKyselyPGlite<TemporalDatabase>(client);

    const row = await db.selectFrom("Event").selectAll().executeTakeFirstOrThrow();

    expect(row).toEqual(pgliteEventRow());
  });

  test("reads Temporal values from the Postgres text that older PGlite versions return", async () => {
    const { client } = createStubClient(
      [
        {
          day: "2026-03-14",
          at: "2026-03-14 09:30:00.123456+00",
          time: "09:30:15.5",
          days: '{2026-03-14,NULL,"2026-03-15"}',
        },
      ],
      undefined,
      eventFields,
    );
    const db = createKyselyPGlite<TemporalDatabase>(client, { temporal: true });

    const row = await db.selectFrom("Event").selectAll().executeTakeFirstOrThrow();

    expect(row.day.toString()).toBe("2026-03-14");
    expect(row.at.toString()).toBe("2026-03-14T09:30:00.123Z");
    expect(row.time.toString()).toBe("09:30:00");
    expect(row.days.map((day) => day?.toString() ?? null)).toEqual([
      "2026-03-14",
      null,
      "2026-03-15",
    ]);
  });
});
