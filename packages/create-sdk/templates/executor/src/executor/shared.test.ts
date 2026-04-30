import { tailordbMock } from "@tailor-platform/sdk/vitest";
import { beforeEach, describe, expect, test } from "vitest";
import { createAuditLog } from "./shared";

describe("createAuditLog", () => {
  beforeEach(() => {
    tailordbMock.reset();
  });

  test("inserts audit log record", async () => {
    await createAuditLog({
      action: "USER_CREATED",
      entityType: "User",
      entityId: "test-id",
      message: "Test audit log",
    });

    expect(tailordbMock.executedQueries).toHaveLength(1);
  });
});
