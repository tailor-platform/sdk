/**
 * Tests for `@tailor-platform/sdk/runtime/aigateway` typed wrappers.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, test } from "vitest";
import * as aigateway from "#/runtime/aigateway";
import { cleanupMocks, injectMocks, mockAigateway } from "#/vitest/mock";

describe("@tailor-platform/sdk/runtime/aigateway", () => {
  beforeEach(() => {
    injectMocks(globalThis);
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  test("get forwards to global and returns Promise<{ url: string }>", async () => {
    using ag = mockAigateway();
    ag.setUrls({ "my-aigateway": "https://my-aigateway.example.com" });

    const result = aigateway.get("my-aigateway");

    expectTypeOf(result).toEqualTypeOf<Promise<aigateway.GetAIGatewayResult>>();
    await expect(result).resolves.toEqual({ url: "https://my-aigateway.example.com" });
    expect(ag.calls).toEqual([{ name: "my-aigateway" }]);
  });

  test("get rejects for an unregistered gateway", async () => {
    using _ag = mockAigateway();
    await expect(aigateway.get("missing")).rejects.toThrow(/missing/);
  });
});
