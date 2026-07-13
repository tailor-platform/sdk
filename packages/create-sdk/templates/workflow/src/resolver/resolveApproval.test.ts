import { describe, expect, test } from "vitest";
import { mockWorkflow } from "@tailor-platform/sdk/vitest";
import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { approval } from "../workflow/approval";
import resolver from "./resolveApproval";

describe("resolveApproval resolver", () => {
  test("resolves approval with approved=true", async () => {
    using wf = mockWorkflow();
    const approvalMock = wf.waitPoint(approval);
    approvalMock.setResolvePayload({
      message: "Please approve order order-1",
      orderId: "order-1",
    });

    const result = await resolver.body({
      input: { executionId: "exec-1", approved: true },
      user: unauthenticatedTailorUser,
      env: {},
    });

    expect(result).toEqual({ resolved: true });
    expect(approvalMock.resolve).toHaveBeenCalledWith("exec-1", expect.any(Function));
  });

  test("resolves approval with approved=false", async () => {
    using wf = mockWorkflow();
    const approvalMock = wf.waitPoint(approval);
    approvalMock.setResolvePayload({ message: "Please approve", orderId: "order-2" });

    const result = await resolver.body({
      input: { executionId: "exec-2", approved: false },
      user: unauthenticatedTailorUser,
      env: {},
    });

    expect(result).toEqual({ resolved: true });
    expect(approvalMock.resolve).toHaveBeenCalledWith("exec-2", expect.any(Function));
  });
});
