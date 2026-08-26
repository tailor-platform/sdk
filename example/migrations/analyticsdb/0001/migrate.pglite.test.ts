import { PGlite } from "@electric-sql/pglite";
import { sql } from "@tailor-platform/sdk/kysely";
import { createKyselyPGlite } from "@tailor-platform/sdk/vitest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { main } from "./migrate";
import type { Database } from "./db";

const db = createKyselyPGlite<Database>(new PGlite());

beforeAll(async () => {
  await sql`
    CREATE TABLE "Event" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" text NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz
    )
  `.execute(db);
});

afterAll(async () => {
  await db.destroy();
});

describe("0001 backfill updatedAt (PGlite)", () => {
  test("backfills updatedAt from createdAt and keeps already-set values", async () => {
    const createdAt = new Date("2024-01-02T03:04:05Z");
    const touchedAt = new Date("2025-05-06T07:08:09Z");
    await sql`
      INSERT INTO "Event" ("name", "createdAt", "updatedAt")
      VALUES ('CLICK', ${createdAt}, NULL), ('VIEW', ${createdAt}, ${touchedAt})
    `.execute(db);

    await db.transaction().execute((trx) => main(trx));

    const rows = await db
      .selectFrom("Event")
      .select(["createdAt", "updatedAt"])
      .orderBy("updatedAt", "asc")
      .execute();
    expect(rows.map((row) => row.updatedAt)).toEqual([createdAt, touchedAt]);
  });
});
