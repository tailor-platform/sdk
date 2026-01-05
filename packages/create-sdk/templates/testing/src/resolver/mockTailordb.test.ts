import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import resolver from "./mockTailordb";

describe("incrementUserAge resolver", () => {
  // Mock queryObject method to simulate database interactions
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

  test("basic functionality", async () => {
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
      env: {},
    });
    expect(result).toEqual({ oldAge: 30, newAge: 31 });
    expect(mockQueryObject).toHaveBeenCalledTimes(4);
  });

  test("user not found", async () => {
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
      env: {},
    });
    await expect(result).rejects.toThrowError();
    expect(mockQueryObject).toHaveBeenCalledTimes(3);
  });
});
