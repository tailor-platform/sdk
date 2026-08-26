import { PGlite } from "@electric-sql/pglite";
import { sql } from "@tailor-platform/sdk/kysely";
import { createKyselyPGlite } from "@tailor-platform/sdk/vitest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { main } from "./migrate";
import type { Database } from "./db";

const db = createKyselyPGlite<Database>(new PGlite());

const createdAt = new Date("2024-01-02T03:04:05Z");
const touchedAt = new Date("2025-05-06T07:08:09Z");

beforeAll(async () => {
  await sql`
    CREATE TABLE "Customer" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" text NOT NULL,
      "email" text NOT NULL,
      "phone" text,
      "country" text NOT NULL,
      "postalCode" text NOT NULL,
      "address" text,
      "city" text,
      "fullAddress" text NOT NULL,
      "state" text NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz
    )
  `.execute(db);

  await sql`
    CREATE TABLE "Invoice" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "invoiceNumber" text NOT NULL,
      "salesOrderID" uuid NOT NULL,
      "amount" integer,
      "sequentialId" integer NOT NULL,
      "status" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz
    )
  `.execute(db);

  await sql`
    CREATE TABLE "NestedProfile" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "userInfo" text NOT NULL,
      "metadata" text NOT NULL,
      "archived" boolean,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz
    )
  `.execute(db);

  await sql`
    CREATE TABLE "PurchaseOrder" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "supplierID" uuid NOT NULL,
      "totalPrice" integer NOT NULL,
      "discount" double precision,
      "status" text NOT NULL,
      "attachedFiles" text[] NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz
    )
  `.execute(db);

  await sql`
    CREATE TABLE "SalesOrder" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "customerID" uuid NOT NULL,
      "approvedByUserIDs" uuid[],
      "totalPrice" integer,
      "discount" double precision,
      "status" text,
      "cancelReason" text,
      "canceledAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz
    )
  `.execute(db);

  await sql`
    CREATE TABLE "Supplier" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" text NOT NULL,
      "phone" text NOT NULL,
      "fax" text,
      "email" text,
      "postalCode" text NOT NULL,
      "country" text NOT NULL,
      "state" text NOT NULL,
      "city" text NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz
    )
  `.execute(db);

  await sql`
    CREATE TABLE "User" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" text NOT NULL,
      "email" text NOT NULL,
      "status" text,
      "department" text,
      "role" text NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz
    )
  `.execute(db);

  await sql`
    CREATE TABLE "UserLog" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "userID" uuid NOT NULL,
      "message" text NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz
    )
  `.execute(db);

  await sql`
    CREATE TABLE "UserSetting" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "language" text NOT NULL,
      "userID" uuid NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz
    )
  `.execute(db);
});

afterAll(async () => {
  await db.destroy();
});

describe("0003 backfill updatedAt (PGlite)", () => {
  test("Customer: backfills updatedAt from createdAt and keeps already-set values", async () => {
    await db
      .insertInto("Customer")
      .values([
        {
          name: "Acme Corp",
          email: "acme@example.com",
          country: "US",
          postalCode: "10001",
          fullAddress: "1 Main St, New York, NY",
          state: "NY",
          createdAt,
          updatedAt: sql`NULL`,
        },
        {
          name: "Globex Corp",
          email: "globex@example.com",
          country: "US",
          postalCode: "10002",
          fullAddress: "2 Main St, New York, NY",
          state: "NY",
          createdAt,
          updatedAt: touchedAt,
        },
      ])
      .execute();

    await db.transaction().execute((trx) => main(trx));

    const rows = await db
      .selectFrom("Customer")
      .select(["updatedAt"])
      .orderBy("updatedAt", "asc")
      .execute();
    expect(rows.map((row) => row.updatedAt)).toEqual([createdAt, touchedAt]);
  });

  test("Invoice: backfills updatedAt from createdAt and keeps already-set values", async () => {
    await db
      .insertInto("Invoice")
      .values([
        {
          invoiceNumber: "INV-01000",
          salesOrderID: sql`gen_random_uuid()`,
          sequentialId: 1,
          createdAt,
          updatedAt: sql`NULL`,
        },
        {
          invoiceNumber: "INV-01001",
          salesOrderID: sql`gen_random_uuid()`,
          sequentialId: 2,
          createdAt,
          updatedAt: touchedAt,
        },
      ])
      .execute();

    await db.transaction().execute((trx) => main(trx));

    const rows = await db
      .selectFrom("Invoice")
      .select(["updatedAt"])
      .orderBy("updatedAt", "asc")
      .execute();
    expect(rows.map((row) => row.updatedAt)).toEqual([createdAt, touchedAt]);
  });

  test("NestedProfile: backfills updatedAt and keeps nested JSON fields intact", async () => {
    const userInfo = JSON.stringify({
      name: "Ada Lovelace",
      age: 36,
      bio: "Mathematician",
      email: "ada@example.com",
      phone: "555-0100",
    });
    const metadata = JSON.stringify({
      created: createdAt.toISOString(),
      lastUpdated: null,
      version: 1,
    });

    await db
      .insertInto("NestedProfile")
      .values([
        { userInfo, metadata, archived: false, createdAt, updatedAt: sql`NULL` },
        { userInfo, metadata, archived: true, createdAt, updatedAt: touchedAt },
      ])
      .execute();

    await db.transaction().execute((trx) => main(trx));

    const rows = await db
      .selectFrom("NestedProfile")
      .select(["userInfo", "metadata", "updatedAt"])
      .orderBy("updatedAt", "asc")
      .execute();
    expect(rows.map((row) => row.updatedAt)).toEqual([createdAt, touchedAt]);
    for (const row of rows) {
      expect(row.userInfo).toBe(userInfo);
      expect(row.metadata).toBe(metadata);
      expect(JSON.parse(row.userInfo)).toEqual(JSON.parse(userInfo));
      expect(JSON.parse(row.metadata)).toEqual(JSON.parse(metadata));
    }
  });

  test("PurchaseOrder: backfills updatedAt from createdAt and keeps already-set values", async () => {
    await db
      .insertInto("PurchaseOrder")
      .values([
        {
          supplierID: sql`gen_random_uuid()`,
          totalPrice: 1000,
          status: "pending",
          attachedFiles: sql`ARRAY[]::text[]`,
          createdAt,
          updatedAt: sql`NULL`,
        },
        {
          supplierID: sql`gen_random_uuid()`,
          totalPrice: 2000,
          status: "approved",
          attachedFiles: sql`ARRAY[]::text[]`,
          createdAt,
          updatedAt: touchedAt,
        },
      ])
      .execute();

    await db.transaction().execute((trx) => main(trx));

    const rows = await db
      .selectFrom("PurchaseOrder")
      .select(["updatedAt"])
      .orderBy("updatedAt", "asc")
      .execute();
    expect(rows.map((row) => row.updatedAt)).toEqual([createdAt, touchedAt]);
  });

  test("SalesOrder: backfills updatedAt from createdAt and keeps already-set values", async () => {
    await db
      .insertInto("SalesOrder")
      .values([
        { customerID: sql`gen_random_uuid()`, createdAt, updatedAt: sql`NULL` },
        { customerID: sql`gen_random_uuid()`, createdAt, updatedAt: touchedAt },
      ])
      .execute();

    await db.transaction().execute((trx) => main(trx));

    const rows = await db
      .selectFrom("SalesOrder")
      .select(["updatedAt"])
      .orderBy("updatedAt", "asc")
      .execute();
    expect(rows.map((row) => row.updatedAt)).toEqual([createdAt, touchedAt]);
  });

  test("Supplier: backfills updatedAt from createdAt and keeps already-set values", async () => {
    await db
      .insertInto("Supplier")
      .values([
        {
          name: "Acme Supplies",
          phone: "555-0200",
          postalCode: "20001",
          country: "US",
          state: "Alabama",
          city: "Mobile",
          createdAt,
          updatedAt: sql`NULL`,
        },
        {
          name: "Globex Supplies",
          phone: "555-0201",
          postalCode: "20002",
          country: "US",
          state: "Alaska",
          city: "Juneau",
          createdAt,
          updatedAt: touchedAt,
        },
      ])
      .execute();

    await db.transaction().execute((trx) => main(trx));

    const rows = await db
      .selectFrom("Supplier")
      .select(["updatedAt"])
      .orderBy("updatedAt", "asc")
      .execute();
    expect(rows.map((row) => row.updatedAt)).toEqual([createdAt, touchedAt]);
  });

  test("User: backfills updatedAt from createdAt and keeps already-set values", async () => {
    await db
      .insertInto("User")
      .values([
        {
          name: "Alice",
          email: "alice@example.com",
          role: "STAFF",
          createdAt,
          updatedAt: sql`NULL`,
        },
        {
          name: "Bob",
          email: "bob@example.com",
          role: "MANAGER",
          createdAt,
          updatedAt: touchedAt,
        },
      ])
      .execute();

    await db.transaction().execute((trx) => main(trx));

    const rows = await db
      .selectFrom("User")
      .select(["updatedAt"])
      .orderBy("updatedAt", "asc")
      .execute();
    expect(rows.map((row) => row.updatedAt)).toEqual([createdAt, touchedAt]);
  });

  test("UserLog: backfills updatedAt from createdAt and keeps already-set values", async () => {
    await sql`
      INSERT INTO "UserLog" ("userID", "message", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'login', ${createdAt}, NULL), (gen_random_uuid(), 'logout', ${createdAt}, ${touchedAt})
    `.execute(db);

    await db.transaction().execute((trx) => main(trx));

    const rows = await db
      .selectFrom("UserLog")
      .select(["createdAt", "updatedAt"])
      .orderBy("updatedAt", "asc")
      .execute();
    expect(rows.map((row) => row.updatedAt)).toEqual([createdAt, touchedAt]);
  });

  test("UserSetting: backfills updatedAt from createdAt and keeps already-set values", async () => {
    await db
      .insertInto("UserSetting")
      .values([
        { language: "en", userID: sql`gen_random_uuid()`, createdAt, updatedAt: sql`NULL` },
        { language: "jp", userID: sql`gen_random_uuid()`, createdAt, updatedAt: touchedAt },
      ])
      .execute();

    await db.transaction().execute((trx) => main(trx));

    const rows = await db
      .selectFrom("UserSetting")
      .select(["updatedAt"])
      .orderBy("updatedAt", "asc")
      .execute();
    expect(rows.map((row) => row.updatedAt)).toEqual([createdAt, touchedAt]);
  });
});
