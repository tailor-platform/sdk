import { describe, expect, test } from "vitest";
import { mockWorkflow } from "@tailor-platform/sdk/vitest";
import workflow, { processWithApproval } from "./approval";

describe("approval workflow", () => {
  test("approved flow returns approved status", async () => {
    using wf = mockWorkflow();
    wf.setWaitHandler((_key, _payload) => ({ approved: true }));

    const result = await processWithApproval.body(
      { orderId: "order-1" },
      { env: {}, invoker: null },
    );

    expect(result).toEqual({ orderId: "order-1", status: "approved" });
    expect(wf.waitCalls).toEqual([
      {
        key: "approval",
        payload: { message: "Please approve order order-1", orderId: "order-1" },
      },
    ]);
  });

  test("rejected flow returns rejected status", async () => {
    using wf = mockWorkflow();
    wf.setWaitHandler({ approved: false });

    const result = await processWithApproval.body(
      { orderId: "order-2" },
      { env: {}, invoker: null },
    );

    expect(result).toEqual({ orderId: "order-2", status: "rejected" });
  });

  test("workflow.mainJob references processWithApproval", () => {
    expect(workflow.mainJob).toBe(processWithApproval);
  });
});
