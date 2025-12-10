import { describe, expect, test, vi } from "vitest";
import { type DbOperations, incrementUserAge } from "./wrapTailordb";

describe("incrementUserAge workflow", () => {
  test("increments existing user age by 1", async () => {
    const dbOperations = {
      getUser: vi.fn().mockResolvedValue({
        email: "test@example.com",
        name: "Test",
        age: 30,
      }),
      createUser: vi.fn(),
      updateUser: vi.fn(),
    } satisfies DbOperations;

    const result = await incrementUserAge(
      { name: "Test", email: "test@example.com", age: 25 },
      dbOperations,
    );

    expect(result).toEqual({ oldAge: 30, newAge: 31 });
    expect(dbOperations.getUser).toHaveBeenCalledExactlyOnceWith(
      "test@example.com",
    );
    expect(dbOperations.createUser).not.toHaveBeenCalled();
    expect(dbOperations.updateUser).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        email: "test@example.com",
        age: 31,
      }),
    );
  });

  test("creates user and increments age when user not found", async () => {
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

    const result = await incrementUserAge(
      { name: "New User", email: "new@example.com", age: 25 },
      dbOperations,
    );

    expect(result).toEqual({ oldAge: 25, newAge: 26 });
    expect(dbOperations.getUser).toHaveBeenCalledExactlyOnceWith(
      "new@example.com",
    );
    expect(dbOperations.createUser).toHaveBeenCalledExactlyOnceWith({
      name: "New User",
      email: "new@example.com",
      age: 25,
    });
    expect(dbOperations.updateUser).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        email: "new@example.com",
        age: 26,
      }),
    );
  });
});
