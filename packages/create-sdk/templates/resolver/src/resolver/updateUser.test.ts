import { describe, expect, test, vi, type Mock } from "vitest";

type MockProcedure = (...args: Parameters<Mock>) => ReturnType<Mock>;
import { type DbOperations, decrementUserAge } from "./updateUser";

describe("decrementUserAge resolver", () => {
  test("decrements user age", async () => {
    const dbOperations = {
      transaction: vi.fn<MockProcedure>(
        async (fn: (ops: DbOperations) => Promise<unknown>) => await fn(dbOperations),
      ),
      getUser: vi.fn<MockProcedure>().mockResolvedValue({ email: "test@example.com", age: 30 }),
      updateUser: vi.fn<MockProcedure>(),
    } as DbOperations;

    const result = await decrementUserAge("test@example.com", dbOperations);

    expect(result).toEqual({ oldAge: 30, newAge: 29 });
    expect(dbOperations.transaction).toHaveBeenCalledTimes(1);
    expect(dbOperations.getUser).toHaveBeenCalledExactlyOnceWith("test@example.com", true);
    expect(dbOperations.updateUser).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        age: 29,
      }),
    );
  });

  test("throws when user not found", async () => {
    const dbOperations = {
      transaction: vi.fn<MockProcedure>(
        async (fn: (ops: DbOperations) => Promise<unknown>) => await fn(dbOperations),
      ),
      getUser: vi.fn<MockProcedure>().mockRejectedValue(new Error("User not found")),
      updateUser: vi.fn<MockProcedure>(),
    } as DbOperations;

    const result = decrementUserAge("test@example.com", dbOperations);

    expect(dbOperations.transaction).toHaveBeenCalledTimes(1);
    expect(dbOperations.getUser).toHaveBeenCalledExactlyOnceWith("test@example.com", true);
    await expect(result).rejects.toThrowError("User not found");
  });
});
