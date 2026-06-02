/**
 * Tests for `@tailor-platform/sdk/runtime/secretmanager` typed wrappers.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, test } from "vitest";
import * as secretmanager from "@/runtime/secretmanager";
import { cleanupMocks, injectMocks, mockSecretmanager } from "@/vitest/mock";

describe("@tailor-platform/sdk/runtime/secretmanager", () => {
  beforeEach(() => {
    injectMocks(globalThis);
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  test("getSecret forwards to global and returns Promise<string | undefined>", async () => {
    using sm = mockSecretmanager();
    sm.setSecrets({ vault: { API_KEY: "sk-123" } });

    const result = secretmanager.getSecret("vault", "API_KEY");

    expectTypeOf(result).toEqualTypeOf<Promise<string | undefined>>();
    await expect(result).resolves.toBe("sk-123");
    expect(sm.calls).toEqual([{ method: "getSecret", vault: "vault", name: "API_KEY" }]);
  });

  test("getSecret returns undefined for missing secret", async () => {
    using _sm = mockSecretmanager();
    await expect(secretmanager.getSecret("vault", "NOPE")).resolves.toBeUndefined();
  });

  test("getSecrets narrows record key to const tuple union", async () => {
    using sm = mockSecretmanager();
    sm.setSecrets({ v: { a: "1", b: "2" } });

    const result = secretmanager.getSecrets("v", ["a", "b"] as const);

    expectTypeOf(result).toEqualTypeOf<Promise<Partial<Record<"a" | "b", string>>>>();
    await expect(result).resolves.toEqual({ a: "1", b: "2" });
    expect(sm.calls).toEqual([{ method: "getSecrets", vault: "v", names: ["a", "b"] }]);
  });

  test("getSecrets omits missing names", async () => {
    using sm = mockSecretmanager();
    sm.setSecrets({ v: { a: "1" } });

    await expect(secretmanager.getSecrets("v", ["a", "b"] as const)).resolves.toEqual({ a: "1" });
  });
});
