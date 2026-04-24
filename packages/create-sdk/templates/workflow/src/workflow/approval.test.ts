import { afterEach, describe, expect, test, vi } from "vitest";
import { setupWaitPointMock } from "@tailor-platform/sdk/test";
import workflow, { processWithApproval } from "./approval";

const TailorGlobal = globalThis as { tailor?: { workflow?: Record<string, unknown> } };

describe("approval workflow", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
    vi.restoreAllMocks();
  });

  test("approved flow returns approved status", async () => {
    const { waitCalls } = setupWaitPointMock({
      onWait: (_key, _payload) => ({ approved: true }),
    });

    const result = await processWithApproval.body({ orderId: "order-1" }, { env: {} });

    expect(result).toEqual({ orderId: "order-1", status: "approved" });
    expect(waitCalls).toHaveLength(1);
    expect(waitCalls[0]).toEqual({
      key: "approval",
      payload: { message: "Please approve order order-1", orderId: "order-1" },
    });
  });

  test("rejected flow returns rejected status", async () => {
    setupWaitPointMock({
      onWait: () => ({ approved: false }),
    });

    const result = await processWithApproval.body({ orderId: "order-2" }, { env: {} });

    expect(result).toEqual({ orderId: "order-2", status: "rejected" });
  });

  test("workflow.mainJob references processWithApproval", () => {
    expect(workflow.mainJob).toBe(processWithApproval);
  });
});
