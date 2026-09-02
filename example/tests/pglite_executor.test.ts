import { PGlite } from "@electric-sql/pglite";
import { mockTailordbWithPGlite } from "@tailor-platform/sdk/vitest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import userRecordLog from "../executors/userRecordLog";
import { getDB } from "../generated/tailordb";

const pglite = new PGlite();

beforeAll(async () => {
  await pglite.exec(`
    CREATE TABLE "User" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" text NOT NULL,
      "email" text NOT NULL,
      "status" text,
      "department" text,
      "role" text NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "UserLog" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "userID" uuid NOT NULL,
      "message" text NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
  `);
});

afterAll(async () => {
  await pglite.close();
});

describe("userRecordLog executor (PGlite)", () => {
  test("logs the created user from real User data", async () => {
    using _db = mockTailordbWithPGlite({ namespaces: { tailordb: pglite } });
    const db = getDB("tailordb");

    const id = crypto.randomUUID();
    const now = new Date();
    await db
      .insertInto("User")
      .values({ id, name: "Alice", email: "alice@tailor.tech", role: "MANAGER" })
      .execute();

    await userRecordLog({
      newRecord: {
        id,
        name: "Alice",
        email: "alice@tailor.tech",
        role: "MANAGER",
        createdAt: now,
        updatedAt: now,
      },
    });

    const logs = await db.selectFrom("UserLog").selectAll().execute();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      userID: id,
      message: "User created: Alice (alice@tailor.tech)",
    });
    expect(logs[0]?.createdAt).toBeInstanceOf(Date);
  });
});
