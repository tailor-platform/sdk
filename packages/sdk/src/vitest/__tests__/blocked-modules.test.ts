import { describe, test, expect } from "vitest";
import { isBlockedModule, getBlockedMessage } from "../blocked-modules";

describe("blocked-modules", () => {
  describe("isBlockedModule", () => {
    test("blocks node: prefixed modules", () => {
      expect(isBlockedModule("node:crypto")).toBe(true);
      expect(isBlockedModule("node:fs")).toBe(true);
      expect(isBlockedModule("node:path")).toBe(true);
      expect(isBlockedModule("node:buffer")).toBe(true);
      expect(isBlockedModule("node:http")).toBe(true);
      expect(isBlockedModule("node:child_process")).toBe(true);
    });

    test("blocks bare specifiers", () => {
      expect(isBlockedModule("crypto")).toBe(true);
      expect(isBlockedModule("fs")).toBe(true);
      expect(isBlockedModule("path")).toBe(true);
      expect(isBlockedModule("buffer")).toBe(true);
    });

    test("blocks subpath modules", () => {
      expect(isBlockedModule("node:fs/promises")).toBe(true);
      expect(isBlockedModule("node:stream/web")).toBe(true);
      expect(isBlockedModule("node:path/posix")).toBe(true);
    });

    test("does not block non-node modules", () => {
      expect(isBlockedModule("vite")).toBe(false);
      expect(isBlockedModule("vitest")).toBe(false);
      expect(isBlockedModule("@tailor-platform/sdk")).toBe(false);
      expect(isBlockedModule("./local-module")).toBe(false);
    });
  });

  describe("getBlockedMessage", () => {
    test("includes module name", () => {
      const msg = getBlockedMessage("node:crypto");
      expect(msg).toContain('"node:crypto"');
      expect(msg).toContain("not available");
    });

    test("includes suggestion for known modules", () => {
      expect(getBlockedMessage("node:crypto")).toContain("Web Crypto API");
      expect(getBlockedMessage("node:buffer")).toContain("Uint8Array");
      expect(getBlockedMessage("node:fs")).toContain("File system");
      expect(getBlockedMessage("node:path")).toContain("URL");
    });

    test("provides base message for unknown modules", () => {
      const msg = getBlockedMessage("node:v8");
      expect(msg).toContain('"node:v8"');
      expect(msg).toContain("not available");
    });
  });
});
