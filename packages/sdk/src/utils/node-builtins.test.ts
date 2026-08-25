import { describe, expect, test } from "vitest";
import { NODE_ONLY_GLOBALS } from "#/utils/es-builtins";
import { getForbiddenGlobalMessage, isForbiddenGlobal } from "./node-builtins";

describe("isForbiddenGlobal", () => {
  test("recognizes Node-only ambient globals", () => {
    expect(isForbiddenGlobal("process")).toBe(true);
    expect(isForbiddenGlobal("Buffer")).toBe(true);
    expect(isForbiddenGlobal("global")).toBe(true);
    expect(isForbiddenGlobal("__dirname")).toBe(true);
    expect(isForbiddenGlobal("__filename")).toBe(true);
    expect(isForbiddenGlobal("require")).toBe(true);
    expect(isForbiddenGlobal("module")).toBe(true);
    expect(isForbiddenGlobal("exports")).toBe(true);
    expect(isForbiddenGlobal("setImmediate")).toBe(true);
    expect(isForbiddenGlobal("clearImmediate")).toBe(true);
  });

  test("does not flag Web Standard globals", () => {
    expect(isForbiddenGlobal("fetch")).toBe(false);
    expect(isForbiddenGlobal("URL")).toBe(false);
    expect(isForbiddenGlobal("crypto")).toBe(false);
    expect(isForbiddenGlobal("TextEncoder")).toBe(false);
    expect(isForbiddenGlobal("console")).toBe(false);
    expect(isForbiddenGlobal("setTimeout")).toBe(false);
  });

  test("does not flag unrelated identifiers", () => {
    expect(isForbiddenGlobal("myLocalHelper")).toBe(false);
  });

  test("does not flag inherited Object.prototype properties", () => {
    expect(isForbiddenGlobal("toString")).toBe(false);
    expect(isForbiddenGlobal("constructor")).toBe(false);
    expect(isForbiddenGlobal("hasOwnProperty")).toBe(false);
    expect(isForbiddenGlobal("__proto__")).toBe(false);
  });

  test("flags every name in NODE_ONLY_GLOBALS, not just the ones with a curated suggestion", () => {
    for (const name of NODE_ONLY_GLOBALS) {
      expect(isForbiddenGlobal(name)).toBe(true);
    }
  });
});

describe("getForbiddenGlobalMessage", () => {
  test("points to the env mechanism for process", () => {
    const message = getForbiddenGlobalMessage("process");
    expect(message).toContain('"process" is not available');
    expect(message).toContain("defineConfig({ env })");
  });

  test("points to Web Standard alternatives", () => {
    expect(getForbiddenGlobalMessage("Buffer")).toContain("Uint8Array");
    expect(getForbiddenGlobalMessage("global")).toContain("globalThis");
    expect(getForbiddenGlobalMessage("setImmediate")).toContain("setTimeout");
    expect(getForbiddenGlobalMessage("clearImmediate")).toContain("clearTimeout");
  });

  test("returns a plain message for a name with no registered suggestion", () => {
    expect(getForbiddenGlobalMessage("toString")).toBe(
      '"toString" is not available in the Tailor Platform runtime.',
    );
  });
});
