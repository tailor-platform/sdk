import { describe, expect, test, vi } from "vitest";
import { type DbOperations, syncUserProfile } from "./wrapTailordb";

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
      getUser: vi.fn().mockResolvedValue(undefined),
      createUser: vi.fn().mockResolvedValue(createdUser),
      updateUser: vi.fn(),
    } satisfies DbOperations;

    const result = await syncUserProfile(
      { name: "New User", email: "new@example.com", age: 25 },
      dbOperations,
    );

    expect(result).toEqual({
      created: true,
      profile: { name: "New User", email: "new@example.com", age: 25 },
    });
    expect(dbOperations.getUser).toHaveBeenCalledExactlyOnceWith(
      "new@example.com",
    );
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
      getUser: vi.fn().mockResolvedValue(existingUser),
      createUser: vi.fn(),
      updateUser: vi.fn(),
    } satisfies DbOperations;

    const result = await syncUserProfile(
      { name: "Updated Name", email: "existing@example.com", age: 31 },
      dbOperations,
    );

    expect(result).toEqual({
      created: false,
      profile: { name: "Updated Name", email: "existing@example.com", age: 31 },
    });
    expect(dbOperations.getUser).toHaveBeenCalledExactlyOnceWith(
      "existing@example.com",
    );
    expect(dbOperations.createUser).not.toHaveBeenCalled();
    expect(dbOperations.updateUser).toHaveBeenCalledExactlyOnceWith(
      "existing@example.com",
      { name: "Updated Name", age: 31 },
    );
  });
});
