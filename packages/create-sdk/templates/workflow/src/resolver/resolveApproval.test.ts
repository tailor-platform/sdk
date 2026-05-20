import { beforeEach, describe, expect, test } from "vitest";
import { workflowMock } from "@tailor-platform/sdk/vitest";
import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import resolver from "./resolveApproval";

describe("resolveApproval resolver", () => {
  beforeEach(() => {
    workflowMock.reset();
  });

  test("resolves approval with approved=true", async () => {
    workflowMock.setResolveHandler((_executionId, _key, callback) => {
      const callbackResult = callback({
        message: "Please approve order order-1",
        orderId: "order-1",
      });
      expect(callbackResult).toEqual({ approved: true });
    });

    const result = await resolver.body({
      input: { executionId: "exec-1", approved: true },
      user: unauthenticatedTailorUser,
      env: {},
    });

    expect(result).toEqual({ resolved: true });
    expect(workflowMock.resolveCalls).toEqual([{ executionId: "exec-1", key: "approval" }]);
  });

  test("resolves approval with approved=false", async () => {
    workflowMock.setResolveHandler((_executionId, _key, callback) => {
      const callbackResult = callback({ message: "Please approve", orderId: "order-2" });
      expect(callbackResult).toEqual({ approved: false });
    });

    const result = await resolver.body({
      input: { executionId: "exec-2", approved: false },
      user: unauthenticatedTailorUser,
      env: {},
    });

    expect(result).toEqual({ resolved: true });
  });
});
