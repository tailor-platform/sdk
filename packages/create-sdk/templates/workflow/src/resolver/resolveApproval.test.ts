import { describe, expect, test } from "vitest";
import { mockWorkflow } from "@tailor-platform/sdk/vitest";
import { approval } from "../workflow/approval";
import resolver from "./resolveApproval";

describe("resolveApproval resolver", () => {
  test("resolves approval with approved=true", async () => {
    using wf = mockWorkflow();
    const approvalMock = wf.waitPoint(approval);
    const payload = {
      message: "Please approve order order-1",
      orderId: "order-1",
    };
    approvalMock.resolve.mockImplementation(async (_executionId, callback) => {
      expect(await callback(payload)).toEqual({ approved: true });
    });

    const result = await resolver.body({
      input: { executionId: "exec-1", approved: true },
      caller: null,
      invoker: null,
      env: {},
    });

    expect(result).toEqual({ resolved: true });
    expect(approvalMock.resolve).toHaveBeenCalledWith("exec-1", expect.any(Function));
  });

  test("resolves approval with approved=false", async () => {
    using wf = mockWorkflow();
    const approvalMock = wf.waitPoint(approval);
    const payload = { message: "Please approve", orderId: "order-2" };
    approvalMock.resolve.mockImplementation(async (_executionId, callback) => {
      expect(await callback(payload)).toEqual({ approved: false });
    });

    const result = await resolver.body({
      input: { executionId: "exec-2", approved: false },
      caller: null,
      invoker: null,
      env: {},
    });

    expect(result).toEqual({ resolved: true });
    expect(approvalMock.resolve).toHaveBeenCalledWith("exec-2", expect.any(Function));
  });
});
