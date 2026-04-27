import { describe, expect, test, vi } from "vitest";
import executor from "./notifyUserCreated";

describe("notifyUserCreated executor", () => {
  test("logs the new user's name and email", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    if (executor.operation.kind !== "function") {
      throw new Error("expected function operation");
    }
    executor.operation.body({
      event: "created",
      rawEvent: "tailordb.type_record.created",
      typeName: "User",
      newRecord: {
        id: "user-1",
        name: "Alice",
        email: "alice@example.com",
        age: 30,
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
      workspaceId: "ws-1",
      appNamespace: "main",
      env: { appName: "Resolver Template", version: 1 },
      actor: null,
    });

    expect(logSpy).toHaveBeenCalledWith("New user created: Alice (alice@example.com)");
  });
});
