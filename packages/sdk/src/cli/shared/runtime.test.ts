import { afterEach, describe, expect, test, vi } from "vitest";
import { isBun, isDeno, isNativeTypeScriptRuntime } from "./runtime";

describe("runtime detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isBun", () => {
    test("returns false in Node.js", () => {
      expect(isBun()).toBe(false);
    });

    test("returns true when Bun global exists", () => {
      vi.stubGlobal("Bun", {});
      expect(isBun()).toBe(true);
    });
  });

  describe("isDeno", () => {
    test("returns false in Node.js", () => {
      expect(isDeno()).toBe(false);
    });

    test("returns true when Deno global exists", () => {
      vi.stubGlobal("Deno", {});
      expect(isDeno()).toBe(true);
    });
  });

  describe("isNativeTypeScriptRuntime", () => {
    test("returns false in Node.js", () => {
      expect(isNativeTypeScriptRuntime()).toBe(false);
    });

    test("returns true when Bun global exists", () => {
      vi.stubGlobal("Bun", {});
      expect(isNativeTypeScriptRuntime()).toBe(true);
    });

    test("returns true when Deno global exists", () => {
      vi.stubGlobal("Deno", {});
      expect(isNativeTypeScriptRuntime()).toBe(true);
    });
  });
});
