import { describe, expect, test } from "vitest";
import { getBlockedMessage, isBlockedModule } from "../blocked-modules";

describe("isBlockedModule", () => {
  test("recognizes node:-prefixed builtins", () => {
    expect(isBlockedModule("node:crypto")).toBe(true);
    expect(isBlockedModule("node:fs")).toBe(true);
    expect(isBlockedModule("node:fs/promises")).toBe(true);
    expect(isBlockedModule("node:url")).toBe(true);
  });

  test("recognizes bare builtins (without node: prefix)", () => {
    expect(isBlockedModule("crypto")).toBe(true);
    expect(isBlockedModule("fs")).toBe(true);
    expect(isBlockedModule("path")).toBe(true);
  });

  test("does not block third-party packages", () => {
    expect(isBlockedModule("@tailor-platform/sdk")).toBe(false);
    expect(isBlockedModule("vitest")).toBe(false);
    expect(isBlockedModule("./local-file")).toBe(false);
  });

  test("does not block unrecognized specifiers (e.g. typo, partial path)", () => {
    expect(isBlockedModule("node:nonexistent")).toBe(false);
    // `crypto/something` is not a builtin specifier — only `crypto` and
    // `node:crypto` are. Subpath imports of builtins (e.g. `node:fs/promises`)
    // appear in `builtinModules` directly when they exist.
    expect(isBlockedModule("crypto/something")).toBe(false);
  });
});

describe("getBlockedMessage", () => {
  test("appends Web Standard suggestion for known builtins", () => {
    const message = getBlockedMessage("node:crypto");
    expect(message).toContain('"node:crypto" is not available');
    expect(message).toContain("Web Crypto API");
  });

  test("strips node: prefix for suggestion lookup so bare and prefixed forms match", () => {
    const bare = getBlockedMessage("crypto");
    const prefixed = getBlockedMessage("node:crypto");
    // Suggestion text is identical; only the embedded specifier differs.
    expect(bare).toContain("Web Crypto API");
    expect(prefixed).toContain("Web Crypto API");
    expect(bare).toContain('"crypto"');
    expect(prefixed).toContain('"node:crypto"');
  });

  test("looks up suggestions by subpath specifier (e.g. fs/promises)", () => {
    const message = getBlockedMessage("node:fs/promises");
    expect(message).toContain('"node:fs/promises" is not available');
    expect(message).toContain("File system access is not available");
  });

  test("returns base message only when no suggestion is registered", () => {
    // node:vm has no SUGGESTIONS entry — verify the fallback path.
    const message = getBlockedMessage("node:vm");
    expect(message).toBe('"node:vm" is not available in the Tailor Platform runtime.');
  });
});
