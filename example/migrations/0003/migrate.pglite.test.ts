import { PGlite } from "@electric-sql/pglite";
import { sql } from "@tailor-platform/sdk/kysely";
import { createKyselyPGlite } from "@tailor-platform/sdk/vitest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { main } from "./migrate";
import type { Database } from "./db";

const TABLES = [
  "Customer",
  "Invoice",
  "NestedProfile",
  "PurchaseOrder",
  "SalesOrder",
  "Supplier",
  "User",
  "UserLog",
  "UserSetting",
] as const;

const db = createKyselyPGlite<Database>(new PGlite());

beforeAll(async () => {
  for (const table of TABLES) {
    await sql`
      CREATE TABLE ${sql.table(table)} (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz
      )
    `.execute(db);
  }
});

afterAll(async () => {
  await db.destroy();
});

describe("0003 backfill updatedAt (PGlite)", () => {
  test("backfills updatedAt from createdAt and keeps already-set values", async () => {
    const createdAt = new Date("2024-01-02T03:04:05Z");
    const touchedAt = new Date("2025-05-06T07:08:09Z");
    await sql`
      INSERT INTO "UserLog" ("createdAt", "updatedAt")
      VALUES (${createdAt}, NULL), (${createdAt}, ${touchedAt})
    `.execute(db);

    await db.transaction().execute((trx) => main(trx));

    const rows = await db
      .selectFrom("UserLog")
      .select(["createdAt", "updatedAt"])
      .orderBy("updatedAt", "asc")
      .execute();
    expect(rows.map((row) => row.updatedAt)).toEqual([createdAt, touchedAt]);
  });
});
