import { describe, expect, test, vi } from "vitest";
import onUserCreated from "./onUserCreated";
import * as shared from "./shared";

describe("onUserCreated executor", () => {
  test("creates an audit log with the new user's name and email", async () => {
    const createAuditLog = vi.spyOn(shared, "createAuditLog").mockResolvedValue(undefined);

    if (onUserCreated.operation.kind !== "function") {
      throw new Error("expected function operation");
    }
    await onUserCreated.operation.body({
      newRecord: {
        id: "user-1",
        name: "Alice",
        email: "alice@example.com",
        role: "ADMIN",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
    });

    expect(createAuditLog).toHaveBeenCalledExactlyOnceWith({
      action: "USER_CREATED",
      entityType: "User",
      entityId: "user-1",
      message: "Admin user created: Alice (alice@example.com)",
    });
  });
});
