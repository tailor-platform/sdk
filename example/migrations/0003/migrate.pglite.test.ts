import { PGlite } from "@electric-sql/pglite";
import { createKyselyPGlite, type Unmigrated } from "@tailor-platform/sdk/vitest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pgliteSchema } from "./db.pglite";
import { main } from "./migrate";
import type { Database } from "./db";

const pglite = new PGlite();
const db = createKyselyPGlite<Unmigrated<Database>>(pglite);

beforeAll(async () => {
  await pglite.exec(pgliteSchema.tailordb);
});

afterAll(async () => {
  await db.destroy();
});

describe("0003 backfill updatedAt (PGlite)", () => {
  test("backfills updatedAt from createdAt and keeps already-set values", async () => {
    const userID = crypto.randomUUID();
    const createdAt = new Date("2024-01-02T03:04:05Z");
    const touchedAt = new Date("2025-05-06T07:08:09Z");
    await db
      .insertInto("UserLog")
      .values([
        { userID, message: "signed in", createdAt, updatedAt: null },
        { userID, message: "signed out", createdAt, updatedAt: touchedAt },
      ])
      .execute();

    await db.transaction().execute((trx) => main(trx));

    const rows = await db
      .selectFrom("UserLog")
      .select(["createdAt", "updatedAt"])
      .orderBy("updatedAt", "asc")
      .execute();
    expect(rows.map((row) => row.updatedAt)).toEqual([createdAt, touchedAt]);
  });
});
