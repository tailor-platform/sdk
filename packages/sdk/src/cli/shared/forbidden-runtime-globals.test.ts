import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import {
  type BundledChunk,
  checkForbiddenRuntimeGlobals,
  warnPackageRuntimeGlobals,
} from "./forbidden-runtime-globals";
import { logger } from "./logger";

const userFile = (relative: string) => path.join(process.cwd(), relative);

const scanBundle = (
  chunk: BundledChunk,
  context: string,
  allowedRuntimeGlobals?: Parameters<typeof warnPackageRuntimeGlobals>[2],
) =>
  warnPackageRuntimeGlobals(
    checkForbiddenRuntimeGlobals(chunk, context),
    context,
    allowedRuntimeGlobals,
  );

const chunkOf = (modules: Record<string, string>) => ({
  code: Object.values(modules).join("\n"),
  modules: Object.fromEntries(Object.entries(modules).map(([id, code]) => [id, { code }])),
});

describe("checkForbiddenRuntimeGlobals and warnPackageRuntimeGlobals", () => {
  test("returns each package's forbidden globals for the caller to warn about", () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const chunk = chunkOf({
      "/app/node_modules/returned-lib/index.js":
        "function run(b) { return process.env.KEY + Buffer.from(b); }",
    });

    expect(checkForbiddenRuntimeGlobals(chunk, 'Resolver "chat"')).toEqual({
      "returned-lib": ["Buffer", "process"],
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("rejects a user module that references a forbidden global and names its file", () => {
    const chunk = chunkOf({
      [userFile("src/resolvers/chat.ts")]: "const main = () => process.env.OPENAI_API_KEY;",
    });

    expect(() => scanBundle(chunk, 'Resolver "chat"')).toThrow(
      expect.objectContaining({
        message:
          'Resolver "chat" references a global unavailable in the Tailor Platform runtime: process.',
        details: expect.stringContaining("src/resolvers/chat.ts"),
      }),
    );
  });

  test("warns instead of failing when only a node_modules package references a forbidden global", () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const chunk = chunkOf({
      "/app/node_modules/warn-only-lib/dist/index.js":
        "function encode(b) { return Buffer.from(b).toString('base64'); }",
      [userFile("src/resolvers/chat.ts")]: "const main = (b) => encode(b);",
    });

    expect(() => scanBundle(chunk, 'Resolver "chat"')).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("warn-only-lib");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("Buffer");
  });

  test("tells how to silence the warning for the package", () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const chunk = chunkOf({
      "/app/node_modules/hint-lib/index.js": "function encode(b) { return Buffer.from(b); }",
    });

    scanBundle(chunk, 'Resolver "chat"');

    expect(warnSpy.mock.calls[0]?.[0]).toContain(
      'add "hint-lib": ["Buffer"] to allowedRuntimeGlobals in defineConfig()',
    );
  });

  test("warns once about the same package across bundles", () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const chunk = chunkOf({
      "/app/node_modules/repeated-lib/index.js": "function encode(b) { return Buffer.from(b); }",
    });

    scanBundle(chunk, 'Resolver "chat"');
    scanBundle(chunk, 'Resolver "summarize"');

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("names a scoped package from the last node_modules segment of a pnpm store path", () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const chunk = chunkOf({
      "/app/node_modules/.pnpm/@scoped+warn-lib@4.0.1/node_modules/@scoped/warn-lib/dist/index.mjs":
        "function encode(b) { return Buffer.from(b); }",
    });

    scanBundle(chunk, 'Resolver "chat"');

    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/^@scoped\/warn-lib /);
  });

  test("recognizes a package whose module id uses Windows path separators", () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const chunk = chunkOf({
      "C:\\app\\node_modules\\windows-lib\\index.js":
        "function encode(b) { return Buffer.from(b); }",
    });

    expect(() => scanBundle(chunk, 'Resolver "chat"')).not.toThrow();
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/^windows-lib /);
  });

  test("still fails when user code and a package both reference the same forbidden global", () => {
    using _warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const chunk = chunkOf({
      "/app/node_modules/shared-ref-lib/index.js": "function cwd() { return process.cwd(); }",
      [userFile("src/executors/sync.ts")]: "const main = () => process.exit(1);",
    });

    expect(() => scanBundle(chunk, 'Executor "sync"')).toThrow(
      expect.objectContaining({ details: expect.stringContaining("src/executors/sync.ts") }),
    );
  });

  test("does not report a forbidden global name that the bundle itself binds", () => {
    const chunk = chunkOf({
      "/app/node_modules/buffer/index.js": "function Buffer() {}",
      [userFile("src/resolvers/chat.ts")]: "const main = (b) => Buffer.from(b);",
    });

    expect(() => scanBundle(chunk, 'Resolver "chat"')).not.toThrow();
  });

  describe("allowedRuntimeGlobals", () => {
    const packageChunk = (packageName: string) =>
      chunkOf({
        [`/app/node_modules/${packageName}/index.js`]:
          "function run(b) { return process.env.KEY + Buffer.from(b); }",
      });

    test("does not warn about the globals listed for a package", () => {
      using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      scanBundle(packageChunk("listed-lib"), 'Resolver "chat"', {
        "listed-lib": ["Buffer", "process"],
      });

      expect(warnSpy).not.toHaveBeenCalled();
    });

    test("does not warn about any global of a package set to true", () => {
      using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      scanBundle(packageChunk("trusted-lib"), 'Resolver "chat"', {
        "trusted-lib": true,
      });

      expect(warnSpy).not.toHaveBeenCalled();
    });

    test("still warns about the globals a package is not allowed to reference", () => {
      using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      scanBundle(packageChunk("partial-lib"), 'Resolver "chat"', {
        "partial-lib": ["process"],
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain(": Buffer.");
    });

    test("does not apply to user code", () => {
      const chunk = chunkOf({
        [userFile("src/resolvers/chat.ts")]: "const main = () => process.env.FOO;",
      });

      expect(() =>
        scanBundle(chunk, 'Resolver "chat"', {
          "src/resolvers/chat.ts": true,
        }),
      ).toThrow(/references a global unavailable in the Tailor Platform runtime: process/);
    });
  });

  test("rejects a forbidden global that no bundled module accounts for", () => {
    const chunk = { code: "const main = () => process.env.FOO;", modules: {} };

    expect(() => scanBundle(chunk, 'Resolver "chat"')).toThrow(
      /references a global unavailable in the Tailor Platform runtime: process/,
    );
  });
});
