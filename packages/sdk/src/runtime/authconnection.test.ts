/**
 * Tests for `@tailor-platform/sdk/runtime/authconnection` typed wrappers.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as authconnection from "#src/runtime/authconnection";
import { mockAuthconnection, cleanupMocks, injectMocks } from "#src/vitest/mock";

describe("@tailor-platform/sdk/runtime/authconnection", () => {
  beforeEach(() => {
    injectMocks(globalThis);
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  test("getConnectionToken forwards to global and records call", async () => {
    using ac = mockAuthconnection();
    ac.setTokens({
      google: { access_token: "ya29.xxx", expires_in: 3600 },
    });

    const result = await authconnection.getConnectionToken("google");

    expect(result).toEqual({ access_token: "ya29.xxx", expires_in: 3600 });
    expect(ac.calls).toEqual([{ connectionName: "google" }]);
  });

  test("returns default token for unknown connection", async () => {
    using _ac = mockAuthconnection();
    const result = await authconnection.getConnectionToken("unknown");

    expect(result).toEqual({ access_token: "mock-token" });
  });
});
