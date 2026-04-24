import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import resolver from "./queryUser";

describe("incrementUserAge resolver", () => {
  const mockQueryObject = vi.fn();
  beforeAll(() => {
    vi.stubGlobal("tailordb", {
      Client: vi.fn(
        class {
          connect = vi.fn();
          end = vi.fn();
          queryObject = mockQueryObject;
        },
      ),
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    mockQueryObject.mockReset();
  });

  test("increments user age", async () => {
    // 1: Begin transaction
    mockQueryObject.mockResolvedValueOnce({});
    // 2: Select current age
    mockQueryObject.mockResolvedValueOnce({
      rows: [{ age: 30 }],
    });
    // 3: Update age
    mockQueryObject.mockResolvedValueOnce({});
    // 4: Commit transaction
    mockQueryObject.mockResolvedValueOnce({});

    const result = await resolver.body({
      input: { email: "test@example.com" },
      user: unauthenticatedTailorUser,
      env: { appName: "Resolver Template", version: 1 },
    });
    expect(result).toEqual({ oldAge: 30, newAge: 31 });
    expect(mockQueryObject).toHaveBeenCalledTimes(4);
  });

  test("throws when user not found", async () => {
    // 1: Begin transaction
    mockQueryObject.mockResolvedValueOnce({});
    // 2: Select current age (no rows returned)
    mockQueryObject.mockResolvedValueOnce({
      rows: [],
    });
    // 3: Rollback transaction
    mockQueryObject.mockResolvedValueOnce({});

    const result = resolver.body({
      input: { email: "test@example.com" },
      user: unauthenticatedTailorUser,
      env: { appName: "Resolver Template", version: 1 },
    });
    await expect(result).rejects.toThrowError();
    expect(mockQueryObject).toHaveBeenCalledTimes(3);
  });
});
