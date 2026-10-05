import { PGlite } from "@electric-sql/pglite";
import { Temporal } from "@tailor-platform/sdk/runtime";
import { mockTailordbWithPGlite } from "@tailor-platform/sdk/vitest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getDB } from "../generated/tailordb";
import { pgliteSchema } from "../generated/tailordb.pglite";

const pglite = new PGlite();

beforeAll(async () => {
  await pglite.exec(pgliteSchema.tailordb);
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

describe("getDB with temporal kyselyTypePlugin (PGlite)", () => {
  test("round-trips date, datetime, and time columns as Temporal values", async () => {
    using _db = mockTailordbWithPGlite({ namespaces: { tailordb: pglite } });
    const db = getDB("tailordb");

    await db
      .insertInto("TemporalCheck")
      .values({
        eventDate: Temporal.PlainDate.from("2026-03-14"),
        eventDatetime: Temporal.Instant.from("2026-03-14T09:30:00.123Z"),
        eventTime: Temporal.PlainTime.from("09:30:00"),
        checkedAt: Temporal.Instant.from("2026-03-14T10:30:00Z"),
      })
      .execute();

    const row = await db.selectFrom("TemporalCheck").selectAll().executeTakeFirstOrThrow();
    expect(row.eventDate).toBeInstanceOf(Temporal.PlainDate);
    expect(row.eventDate.toString()).toBe("2026-03-14");
    expect(row.eventDatetime).toBeInstanceOf(Temporal.Instant);
    expect(row.eventDatetime.toString()).toBe("2026-03-14T09:30:00.123Z");
    expect(row.eventTime).toBeInstanceOf(Temporal.PlainTime);
    expect(row.eventTime.toString()).toBe("09:30:00");
  });
});
