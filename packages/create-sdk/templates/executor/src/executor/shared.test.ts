import { mockTailordb } from "@tailor-platform/sdk/vitest";
import { describe, expect, test } from "vitest";
import { createAuditLog } from "./shared";

describe("createAuditLog", () => {
  test("inserts audit log record", async () => {
    using db = mockTailordb();
    await createAuditLog({
      action: "USER_CREATED",
      entityType: "User",
      entityId: "test-id",
      message: "Test audit log",
    });

    expect(db.executedQueries).toHaveLength(1);
  });
});
