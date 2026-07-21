/**
 * Tests for `@tailor-platform/sdk/runtime/context` typed wrappers.
 */
import { aroundEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import * as context from "#/runtime/context";
import { injectMocks } from "#/vitest/mock";

describe("@tailor-platform/sdk/runtime/context", () => {
  aroundEach(async (runTest) => {
    using _mocks = injectMocks(globalThis);
    await runTest();
  });

  test("getInvoker returns null for anonymous invocations", () => {
    const result = context.getInvoker();

    expectTypeOf(result).toEqualTypeOf<context.Invoker | null>();
    expect(result).toBeNull();
  });

  test("getInvoker exposes SDK shape (attributes map + attributeList array)", () => {
    using _invokerSpy = vi.spyOn(globalThis.tailor.context, "getInvoker").mockReturnValue({
      id: "u-1",
      type: "machine_user",
      workspaceId: "ws-1",
      attributes: ["role"],
      attributeMap: { role: "MANAGER" },
    });

    const invoker = context.getInvoker();

    expect(invoker).toEqual({
      id: "u-1",
      type: "machine_user",
      workspaceId: "ws-1",
      attributes: { role: "MANAGER" },
      attributeList: ["role"],
    });
  });
});
