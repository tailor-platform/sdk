import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { tailordbMock } from "@tailor-platform/sdk/vitest";
import { describe, expect, test } from "vitest";
import resolver from "./incrementUserAge";

describe("incrementUserAge resolver", () => {
  test("increments user age", async () => {
    using db = tailordbMock();
    db.enqueueResults(
      [], // BEGIN
      [{ age: 30 }], // SELECT
      [], // UPDATE
      [], // COMMIT
    );

    const result = await resolver.body({
      input: { email: "test@example.com" },
      user: unauthenticatedTailorUser,
      env: { appName: "Resolver Template", version: 1 },
    });
    expect(result).toEqual({ oldAge: 30, newAge: 31 });
    expect(db.executedQueries).toHaveLength(4);
  });

  test("throws when user not found", async () => {
    using db = tailordbMock();
    db.enqueueResults(
      [], // BEGIN
      [], // SELECT (empty)
      [], // ROLLBACK
    );

    const result = resolver.body({
      input: { email: "test@example.com" },
      user: unauthenticatedTailorUser,
      env: { appName: "Resolver Template", version: 1 },
    });
    await expect(result).rejects.toThrowError();
    expect(db.executedQueries).toHaveLength(3);
  });
});
