import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createAuditLog } from "./shared";

describe("createAuditLog", () => {
  const mockQueryObject = vi.fn();
  beforeAll(() => {
    vi.stubGlobal("tailordb", {
      Client: vi.fn(
        class {
          connect = vi.fn();
          end = vi.fn();
          queryObject = mockQueryObject;
        },
      ),
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    mockQueryObject.mockReset();
  });

  test("inserts audit log record", async () => {
    mockQueryObject.mockResolvedValueOnce({});

    await createAuditLog({
      action: "USER_CREATED",
      entityType: "User",
      entityId: "test-id",
      message: "Test audit log",
    });

    expect(mockQueryObject).toHaveBeenCalledTimes(1);
  });
});
