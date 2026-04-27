import { afterEach, describe, expect, test } from "vitest";
import { setupWaitPointMock, unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import resolver from "./resolveApproval";

const TailorGlobal = globalThis as { tailor?: { workflow?: Record<string, unknown> } };

describe("resolveApproval resolver", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
  });

  test("resolves approval with approved=true", async () => {
    const { resolveCalls } = setupWaitPointMock({
      onResolve: (_execId, _key, callback) => {
        const result = callback({ message: "Please approve order order-1", orderId: "order-1" });
        expect(result).toEqual({ approved: true });
      },
    });

    const result = await resolver.body({
      input: { executionId: "exec-1", approved: true },
      user: unauthenticatedTailorUser,
      env: {},
    });

    expect(result).toEqual({ resolved: true });
    expect(resolveCalls).toHaveLength(1);
    expect(resolveCalls[0]).toEqual({ executionId: "exec-1", key: "approval" });
  });

  test("resolves approval with approved=false", async () => {
    setupWaitPointMock({
      onResolve: (_execId, _key, callback) => {
        const result = callback({ message: "Please approve", orderId: "order-2" });
        expect(result).toEqual({ approved: false });
      },
    });

    const result = await resolver.body({
      input: { executionId: "exec-2", approved: false },
      user: unauthenticatedTailorUser,
      env: {},
    });

    expect(result).toEqual({ resolved: true });
  });
});
