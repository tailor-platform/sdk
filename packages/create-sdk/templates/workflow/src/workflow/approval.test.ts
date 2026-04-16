import { afterEach, describe, expect, test, vi } from "vitest";
import { setupWaitPointMock } from "@tailor-platform/sdk/test";
import workflow, { approval, processWithApproval } from "./approval";

const TailorGlobal = globalThis as { tailor?: { workflow?: Record<string, unknown> } };

describe("approval workflow", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
    vi.restoreAllMocks();
  });

  describe("wait/resolve coordination", () => {
    test("approved flow returns approved status", async () => {
      const resultPromise = processWithApproval.body({ orderId: "order-1" }, { env: {} });

      await approval.resolve("exec-1", (payload) => {
        expect(payload).toEqual({
          message: "Please approve order order-1",
          orderId: "order-1",
        });
        return { approved: true };
      });

      expect(await resultPromise).toEqual({ orderId: "order-1", status: "approved" });
    });

    test("rejected flow returns rejected status", async () => {
      const resultPromise = processWithApproval.body({ orderId: "order-2" }, { env: {} });

      await approval.resolve("exec-2", () => ({ approved: false }));

      expect(await resultPromise).toEqual({ orderId: "order-2", status: "rejected" });
    });
  });

  describe("with setupWaitPointMock", () => {
    test("mock wait returns controlled result", async () => {
      const { waitCalls } = setupWaitPointMock({
        onWait: (_key, _payload) => ({ approved: true }),
      });

      const result = await processWithApproval.body({ orderId: "order-3" }, { env: {} });

      expect(result).toEqual({ orderId: "order-3", status: "approved" });
      expect(waitCalls).toHaveLength(1);
      expect(waitCalls[0]).toEqual({
        key: "approval",
        payload: { message: "Please approve order order-3", orderId: "order-3" },
      });
    });
  });

  test("workflow.mainJob references processWithApproval", () => {
    expect(workflow.mainJob).toBe(processWithApproval);
  });
});
