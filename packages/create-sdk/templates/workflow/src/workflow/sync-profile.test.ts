import { describe, expect, test, vi, type Mock } from "vitest";

type MockProcedure = (...args: Parameters<Mock>) => ReturnType<Mock>;
import { type DbOperations, syncUserProfile } from "./sync-profile";

describe("syncUserProfile workflow", () => {
  test("creates new user when not found", async () => {
    const createdUser = {
      id: "new-user-id",
      email: "new@example.com",
      name: "New User",
      age: 25,
      createdAt: new Date(),
      updatedAt: null,
    };
    const dbOperations = {
      getUser: vi.fn<MockProcedure>().mockResolvedValue(undefined),
      createUser: vi.fn<MockProcedure>().mockResolvedValue(createdUser),
      updateUser: vi.fn<MockProcedure>(),
    } satisfies DbOperations;

    const result = await syncUserProfile(
      { name: "New User", email: "new@example.com", age: 25 },
      dbOperations,
    );

    expect(result).toEqual({
      created: true,
      profile: { name: "New User", email: "new@example.com", age: 25 },
    });
    expect(dbOperations.getUser).toHaveBeenCalledExactlyOnceWith("new@example.com");
    expect(dbOperations.createUser).toHaveBeenCalledExactlyOnceWith({
      name: "New User",
      email: "new@example.com",
      age: 25,
    });
    expect(dbOperations.updateUser).not.toHaveBeenCalled();
  });

  test("updates existing user when found", async () => {
    const existingUser = {
      id: "existing-user-id",
      email: "existing@example.com",
      name: "Old Name",
      age: 30,
      createdAt: new Date(),
      updatedAt: null,
    };
    const dbOperations = {
      getUser: vi.fn<MockProcedure>().mockResolvedValue(existingUser),
      createUser: vi.fn<MockProcedure>(),
      updateUser: vi.fn<MockProcedure>(),
    } satisfies DbOperations;

    const result = await syncUserProfile(
      { name: "Updated Name", email: "existing@example.com", age: 31 },
      dbOperations,
    );

    expect(result).toEqual({
      created: false,
      profile: { name: "Updated Name", email: "existing@example.com", age: 31 },
    });
    expect(dbOperations.getUser).toHaveBeenCalledExactlyOnceWith("existing@example.com");
    expect(dbOperations.createUser).not.toHaveBeenCalled();
    expect(dbOperations.updateUser).toHaveBeenCalledExactlyOnceWith("existing@example.com", {
      name: "Updated Name",
      age: 31,
    });
  });
});
