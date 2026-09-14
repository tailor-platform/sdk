import { PGlite } from "@electric-sql/pglite";
import { mockTailordbWithPGlite } from "@tailor-platform/sdk/vitest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import userRecordLog from "../executors/userRecordLog";
import { getDB } from "../generated/tailordb";
import { pgliteSchema } from "../generated/tailordb.pglite";

const pglite = new PGlite();

beforeAll(async () => {
  await pglite.exec(pgliteSchema.tailordb);
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
