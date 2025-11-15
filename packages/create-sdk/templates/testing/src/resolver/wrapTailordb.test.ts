import { describe, expect, test, vi } from "vitest";
import { DbOperations, decrementUserAge } from "./wrapTailordb";

describe("decrementUserAge resolver", () => {
  test("basic functionality", async () => {
    // Mock database operations
    const dbOperations = {
      transaction: vi.fn(
        async (fn: (ops: DbOperations) => Promise<unknown>) =>
          await fn(dbOperations),
      ),
      getUser: vi
        .fn()
        .mockResolvedValue({ email: "test@example.com", age: 30 }),
      updateUser: vi.fn(),
    } as DbOperations;

    const result = await decrementUserAge("test@example.com", dbOperations);

    expect(result).toEqual({ oldAge: 30, newAge: 29 });
    expect(dbOperations.transaction).toHaveBeenCalledTimes(1);
    expect(dbOperations.getUser).toHaveBeenCalledExactlyOnceWith(
      "test@example.com",
      true,
    );
    expect(dbOperations.updateUser).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        age: 29,
      }),
    );
  });

  test("user not found", async () => {
    // Mock database operations
    const dbOperations = {
      transaction: vi.fn(
        async (fn: (ops: DbOperations) => Promise<unknown>) =>
          await fn(dbOperations),
      ),
      getUser: vi.fn().mockRejectedValue(new Error("User not found")),
      updateUser: vi.fn(),
    } as DbOperations;

    const result = decrementUserAge("test@example.com", dbOperations);

    expect(dbOperations.transaction).toHaveBeenCalledTimes(1);
    expect(dbOperations.getUser).toHaveBeenCalledExactlyOnceWith(
      "test@example.com",
      true,
    );
    await expect(result).rejects.toThrowError();
  });
});
