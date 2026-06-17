import { describe, expect, test } from "vitest";
import { mockWorkflow } from "@tailor-platform/sdk/vitest";
import resolver from "./resolveApproval";

describe("resolveApproval resolver", () => {
  test("resolves approval with approved=true", async () => {
    using wf = mockWorkflow();
    wf.setResolveHandler((_executionId, _key, callback) => {
      const callbackResult = callback({
        message: "Please approve order order-1",
        orderId: "order-1",
      });
      expect(callbackResult).toEqual({ approved: true });
    });

    const result = await resolver.body({
      input: { executionId: "exec-1", approved: true },
      caller: null,
      invoker: null,
      env: {},
    });

    expect(result).toEqual({ resolved: true });
    expect(wf.resolveCalls).toEqual([{ executionId: "exec-1", key: "approval" }]);
  });

  test("resolves approval with approved=false", async () => {
    using wf = mockWorkflow();
    wf.setResolveHandler((_executionId, _key, callback) => {
      const callbackResult = callback({ message: "Please approve", orderId: "order-2" });
      expect(callbackResult).toEqual({ approved: false });
    });

    const result = await resolver.body({
      input: { executionId: "exec-2", approved: false },
      caller: null,
      invoker: null,
      env: {},
    });

    expect(result).toEqual({ resolved: true });
  });
});
