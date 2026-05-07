/**
 * Tests for `@tailor-platform/sdk/runtime/context` typed wrappers.
 */
import "@/runtime/globals";
import { afterEach, beforeEach, describe, expect, expectTypeOf, test } from "vitest";
import * as context from "@/runtime/context";
import { cleanupMocks, injectMocks } from "@/vitest/mock";

describe("@tailor-platform/sdk/runtime/context", () => {
  beforeEach(() => {
    injectMocks(globalThis);
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  test("getInvoker forwards to global and returns Invoker | null", () => {
    const result = context.getInvoker();

    expectTypeOf(result).toEqualTypeOf<context.Invoker | null>();
    expect(result).toBeNull();
  });
});
