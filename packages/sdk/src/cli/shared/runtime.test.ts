import { afterEach, describe, expect, it, vi } from "vitest";
import { isBun, isDeno, isNativeTypeScriptRuntime } from "./runtime";

describe("runtime detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isBun", () => {
    it("returns false in Node.js", () => {
      expect(isBun()).toBe(false);
    });

    it("returns true when Bun global exists", () => {
      vi.stubGlobal("Bun", {});
      expect(isBun()).toBe(true);
    });
  });

  describe("isDeno", () => {
    it("returns false in Node.js", () => {
      expect(isDeno()).toBe(false);
    });

    it("returns true when Deno global exists", () => {
      vi.stubGlobal("Deno", {});
      expect(isDeno()).toBe(true);
    });
  });

  describe("isNativeTypeScriptRuntime", () => {
    it("returns false in Node.js", () => {
      expect(isNativeTypeScriptRuntime()).toBe(false);
    });

    it("returns true when Bun global exists", () => {
      vi.stubGlobal("Bun", {});
      expect(isNativeTypeScriptRuntime()).toBe(true);
    });

    it("returns true when Deno global exists", () => {
      vi.stubGlobal("Deno", {});
      expect(isNativeTypeScriptRuntime()).toBe(true);
    });
  });
});
