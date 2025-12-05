import { describe, expect, test, vi } from "vitest";
import { DbOperations, incrementUserAge } from "./wrapTailordb";

describe("incrementUserAge workflow", () => {
  test("increments user age by 1", async () => {
    const dbOperations = {
      getUser: vi.fn().mockResolvedValue({
        email: "test@example.com",
        name: "Test",
        age: 30,
      }),
      updateUser: vi.fn(),
    } as DbOperations;

    const result = await incrementUserAge("test@example.com", dbOperations);

    expect(result).toEqual({ oldAge: 30, newAge: 31 });
    expect(dbOperations.getUser).toHaveBeenCalledExactlyOnceWith(
      "test@example.com",
    );
    expect(dbOperations.updateUser).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        email: "test@example.com",
        age: 31,
      }),
    );
  });

  test("throws error when user not found", async () => {
    const dbOperations = {
      getUser: vi.fn().mockRejectedValue(new Error("User not found")),
      updateUser: vi.fn(),
    } as DbOperations;

    await expect(
      incrementUserAge("nonexistent@example.com", dbOperations),
    ).rejects.toThrowError("User not found");

    expect(dbOperations.getUser).toHaveBeenCalledExactlyOnceWith(
      "nonexistent@example.com",
    );
    expect(dbOperations.updateUser).not.toHaveBeenCalled();
  });
});
