import * as path from "pathe";
import { describe, expect, test } from "vitest";
import {
  assertPackageRuntimeGlobalsAllowed,
  type BundledChunk,
  checkForbiddenRuntimeGlobals,
} from "./forbidden-runtime-globals";

const userFile = (relative: string) => path.join(process.cwd(), relative);

const scanBundle = (
  chunk: BundledChunk,
  context: string,
  allowedRuntimeGlobals?: Parameters<typeof assertPackageRuntimeGlobalsAllowed>[2],
) =>
  assertPackageRuntimeGlobalsAllowed(
    checkForbiddenRuntimeGlobals(chunk, context),
    context,
    allowedRuntimeGlobals,
  );

const chunkOf = (modules: Record<string, string>) => ({
  code: Object.values(modules).join("\n"),
  modules: Object.fromEntries(Object.entries(modules).map(([id, code]) => [id, { code }])),
});

const bufferPackageChunk = (moduleId: string) =>
  chunkOf({ [moduleId]: "function encode(b) { return Buffer.from(b); }" });

describe("checkForbiddenRuntimeGlobals and assertPackageRuntimeGlobalsAllowed", () => {
  test("returns each package's forbidden globals instead of failing on them", () => {
    const chunk = chunkOf({
      "/app/node_modules/returned-lib/index.js":
        "function run(b) { return process.env.KEY + Buffer.from(b); }",
    });

    expect(checkForbiddenRuntimeGlobals(chunk, 'Resolver "chat"')).toEqual({
      "returned-lib": ["Buffer", "process"],
    });
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

  test("rejects a bundle whose installed package references a forbidden global and names the package", () => {
    const chunk = chunkOf({
      "/app/node_modules/encode-lib/dist/index.js":
        "function encode(b) { return Buffer.from(b).toString('base64'); }",
      [userFile("src/resolvers/chat.ts")]: "const main = (b) => encode(b);",
    });

    expect(() => scanBundle(chunk, 'Resolver "chat"')).toThrow(
      expect.objectContaining({
        code: "FORBIDDEN_RUNTIME_GLOBAL",
        message:
          'Resolver "chat" references a global unavailable in the Tailor Platform runtime: Buffer.',
        details: expect.stringContaining("encode-lib"),
        context: { packages: { "encode-lib": ["Buffer"] } },
      }),
    );
  });

  test("suggests the allowedRuntimeGlobals entry that allows the package's reference", () => {
    expect(() =>
      scanBundle(bufferPackageChunk("/app/node_modules/hint-lib/index.js"), 'Resolver "chat"'),
    ).toThrow(
      expect.objectContaining({
        suggestion: expect.stringContaining(
          'buildOptions: { allowedRuntimeGlobals: { "hint-lib": ["Buffer"] } }',
        ),
      }),
    );
  });

  test("names a scoped package from the last node_modules segment of a pnpm store path", () => {
    const chunk = bufferPackageChunk(
      "/app/node_modules/.pnpm/@scoped+lib@4.0.1/node_modules/@scoped/lib/dist/index.mjs",
    );

    expect(checkForbiddenRuntimeGlobals(chunk, 'Resolver "chat"')).toEqual({
      "@scoped/lib": ["Buffer"],
    });
  });

  test("recognizes a package whose module id uses Windows path separators", () => {
    const chunk = bufferPackageChunk("C:\\app\\node_modules\\windows-lib\\index.js");

    expect(checkForbiddenRuntimeGlobals(chunk, 'Resolver "chat"')).toEqual({
      "windows-lib": ["Buffer"],
    });
  });

  test("names the user file when user code and a package both reference the same forbidden global", () => {
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

    test("accepts the globals listed for a package", () => {
      expect(() =>
        scanBundle(packageChunk("listed-lib"), 'Resolver "chat"', {
          "listed-lib": ["Buffer", "process"],
        }),
      ).not.toThrow();
    });

    test("accepts every global of a package set to true", () => {
      expect(() =>
        scanBundle(packageChunk("trusted-lib"), 'Resolver "chat"', { "trusted-lib": true }),
      ).not.toThrow();
    });

    test("still rejects the globals a package is not allowed to reference", () => {
      expect(() =>
        scanBundle(packageChunk("partial-lib"), 'Resolver "chat"', {
          "partial-lib": ["process"],
        }),
      ).toThrow(
        expect.objectContaining({
          message:
            'Resolver "chat" references a global unavailable in the Tailor Platform runtime: Buffer.',
        }),
      );
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
