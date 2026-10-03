import { PGlite } from "@electric-sql/pglite";
import { Temporal } from "@tailor-platform/sdk/runtime";
import { createKyselyPGlite, type Unmigrated } from "@tailor-platform/sdk/vitest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pgliteSchema } from "./db.pglite";
import { main } from "./migrate";
import type { Database } from "./db";

const pglite = new PGlite();
const db = createKyselyPGlite<Unmigrated<Database>>(pglite, { temporal: true });

// PGlite loads Postgres on first use, which can take longer than the default hook timeout.
beforeAll(async () => {
  await pglite.exec(pgliteSchema.tailordb);
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

describe("0010 populate checkedAt (PGlite)", () => {
  test("sets checkedAt to one hour after eventDatetime", async () => {
    await db
      .insertInto("TemporalCheck")
      .values({
        eventDate: Temporal.PlainDate.from("2026-03-14"),
        eventDatetime: Temporal.Instant.from("2026-03-14T09:30:00Z"),
        eventTime: Temporal.PlainTime.from("09:30:00"),
      })
      .execute();

    await db.transaction().execute((trx) => main(trx));

    const rows = await db.selectFrom("TemporalCheck").select(["checkedAt"]).execute();
    expect(rows.map((row) => row.checkedAt?.toString())).toEqual(["2026-03-14T10:30:00Z"]);
  });
});
