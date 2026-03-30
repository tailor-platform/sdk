import { describe, expect, test } from "vitest";
import { createBlockPlugin } from "../plugin";

describe("createBlockPlugin", () => {
  const plugin = createBlockPlugin();
  // resolveId is a function on the plugin object
  const resolveId = plugin.resolveId as (
    source: string,
    importer: string | undefined,
  ) => string | undefined;
  const load = plugin.load as (id: string) => string | undefined;

  describe("resolveId", () => {
    test("blocks node:* imports from production code", () => {
      const result = resolveId("node:crypto", "/app/src/resolver/myResolver.ts");
      expect(result).toContain("tailor-blocked:");
      expect(result).toContain("node:crypto");
    });

    test("allows node:* imports from test files", () => {
      expect(resolveId("node:crypto", "/app/src/resolver/myResolver.test.ts")).toBeUndefined();
      expect(resolveId("node:fs", "/app/tests/helper.spec.ts")).toBeUndefined();
      expect(resolveId("node:path", "/app/src/utils.test.mts")).toBeUndefined();
    });

    test("allows non-node imports from any file", () => {
      expect(resolveId("vite", "/app/src/resolver/myResolver.ts")).toBeUndefined();
      expect(resolveId("./local", "/app/src/resolver/myResolver.ts")).toBeUndefined();
    });

    test("blocks bare specifiers from production code", () => {
      const result = resolveId("crypto", "/app/src/resolver/myResolver.ts");
      expect(result).toContain("tailor-blocked:");
    });

    test("does not block when importer is undefined", () => {
      expect(resolveId("node:crypto", undefined)).toBeUndefined();
    });
  });

  describe("load", () => {
    test("returns throwing code for blocked modules", () => {
      const code = load("\0tailor-blocked:node:crypto");
      expect(code).toContain("throw new Error");
      expect(code).toContain("node:crypto");
      expect(code).toContain("Web Crypto API");
    });

    test("returns undefined for non-blocked modules", () => {
      expect(load("some-other-module")).toBeUndefined();
    });
  });
});
