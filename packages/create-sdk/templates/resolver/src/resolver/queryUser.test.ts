import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { tailordbMock } from "@tailor-platform/sdk/vitest";
import { beforeEach, describe, expect, test } from "vitest";
import resolver from "./queryUser";

describe("incrementUserAge resolver", () => {
  beforeEach(() => {
    tailordbMock.reset();
  });

  test("increments user age", async () => {
    // 1: BEGIN, 2: SELECT, 3: UPDATE, 4: COMMIT
    tailordbMock.enqueueResult([]);
    tailordbMock.enqueueResult([{ age: 30 }]);
    tailordbMock.enqueueResult([]);
    tailordbMock.enqueueResult([]);

    const result = await resolver.body({
      input: { email: "test@example.com" },
      user: unauthenticatedTailorUser,
      env: { appName: "Resolver Template", version: 1 },
    });
    expect(result).toEqual({ oldAge: 30, newAge: 31 });
    expect(tailordbMock.executedQueries).toHaveLength(4);
  });

  test("throws when user not found", async () => {
    // 1: BEGIN, 2: SELECT (empty), 3: ROLLBACK
    tailordbMock.enqueueResult([]);
    tailordbMock.enqueueResult([]);
    tailordbMock.enqueueResult([]);

    const result = resolver.body({
      input: { email: "test@example.com" },
      user: unauthenticatedTailorUser,
      env: { appName: "Resolver Template", version: 1 },
    });
    await expect(result).rejects.toThrowError();
    expect(tailordbMock.executedQueries).toHaveLength(3);
  });
});
