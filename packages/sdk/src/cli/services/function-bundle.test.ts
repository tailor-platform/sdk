import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { createBundleCache } from "#/cli/cache/bundle-cache";
import { createCacheStore } from "#/cli/cache/store";
import { logger } from "#/cli/shared/logger";
import { extractInlineSourcemap } from "#/cli/shared/stack-trace";
import { normalizeFilePath, type StartContext } from "#/cli/shared/start-context";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { assertDefined } from "#/utils/assert";
import { buildFunctionBundle, type BuildFunctionBundleOptions } from "./function-bundle";

function writeFunction(projectDir: string, source: string): string {
  const sourceFile = path.join(projectDir, "src/function.ts");
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.writeFileSync(sourceFile, source);
  return sourceFile;
}

function writeBufferEncodingPackage(projectDir: string, name: string): void {
  const packageDir = path.join(projectDir, "node_modules", name);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name, type: "module", exports: { ".": "./index.js" } }),
  );
  fs.writeFileSync(
    path.join(packageDir, "index.js"),
    'export const encode = (text) => Buffer.from(text).toString("base64");\n',
  );
}

function writeEncodingFunction(projectDir: string, packageName: string): string {
  writeBufferEncodingPackage(projectDir, packageName);
  return writeFunction(
    projectDir,
    `import { encode } from "${packageName}";\n` +
      `export default async () => encode("OWN_SOURCE");\n`,
  );
}

function bundle(
  sourceFile: string,
  options: Partial<BuildFunctionBundleOptions> = {},
): Promise<string> {
  return buildFunctionBundle({
    kind: "executor",
    name: "fn",
    sourceFile,
    tsconfig: undefined,
    runtimeGlobals: { label: 'Function "fn"' },
    entry: (absoluteSourcePath) => `export { default as main } from "${absoluteSourcePath}";\n`,
    ...options,
  });
}

describe("buildFunctionBundle runtime globals", () => {
  test("rejects a function that references a forbidden global, naming the function and its file", async () => {
    using tmp = tempCwd("sdk-function-bundle-forbidden-global-");
    const sourceFile = writeFunction(
      tmp.dir,
      `export default async () => (process.env.SOME_FLAG === "1" ? 1 : 0);\n`,
    );

    await expect(bundle(sourceFile)).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          'Function "fn" references a global unavailable in the Tailor Platform runtime: process',
        ),
        details: expect.stringContaining("src/function.ts"),
      }),
    );
  });

  test("bundles a function that references a forbidden global when the check is turned off", async () => {
    using tmp = tempCwd("sdk-function-bundle-unchecked-global-");
    const sourceFile = writeFunction(
      tmp.dir,
      `export default async () => (process.env.SOME_FLAG === "1" ? 1 : 0);\n`,
    );

    await expect(bundle(sourceFile, { runtimeGlobals: false })).resolves.toContain("process.env");
  });

  test("rejects an installed package that references a forbidden global and names the package", async () => {
    using tmp = tempCwd("sdk-function-bundle-package-global-");
    const sourceFile = writeEncodingFunction(tmp.dir, "buffer-lib");

    await expect(bundle(sourceFile)).rejects.toThrow(
      expect.objectContaining({ details: expect.stringContaining("buffer-lib") }),
    );
  });

  test("bundles an installed package whose global allowedRuntimeGlobals allows", async () => {
    using tmp = tempCwd("sdk-function-bundle-allowed-package-global-");
    const sourceFile = writeEncodingFunction(tmp.dir, "allowed-buffer-lib");

    await expect(
      bundle(sourceFile, {
        runtimeGlobals: { label: 'Function "fn"', allowed: { "allowed-buffer-lib": ["Buffer"] } },
      }),
    ).resolves.toContain("base64");
  });

  test("rejects a cached bundle once its package's forbidden global is no longer allowed", async () => {
    using tmp = tempCwd("sdk-function-bundle-cached-package-global-");
    using debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
    const sourceFile = writeEncodingFunction(tmp.dir, "cached-buffer-lib");
    const cache = createBundleCache(createCacheStore({ cacheDir: path.join(tmp.dir, ".cache") }));
    await bundle(sourceFile, {
      cache,
      runtimeGlobals: { label: 'Function "fn"', allowed: { "cached-buffer-lib": ["Buffer"] } },
    });

    await expect(bundle(sourceFile, { cache })).rejects.toThrow(
      expect.objectContaining({ details: expect.stringContaining("cached-buffer-lib") }),
    );
    expect(debugSpy).toHaveBeenCalledWith(expect.stringMatching(/cached.*fn/));
  });

  test("bundles a function that uses Web Standard globals", async () => {
    using tmp = tempCwd("sdk-function-bundle-web-standard-");
    const sourceFile = writeFunction(
      tmp.dir,
      `export default async () => (await fetch(new URL("https://example.com"))).status;\n`,
    );

    await expect(bundle(sourceFile)).resolves.toContain("example.com");
  });
});

describe("buildFunctionBundle start transform", () => {
  test("rewrites .start() calls through the start context by default", async () => {
    using tmp = tempCwd("sdk-function-bundle-start-transform-");
    const sourceFile = writeFunction(
      tmp.dir,
      `const flow = { start: () => "UNTRANSFORMED" };\n` +
        `export default async () => flow.start({});\n`,
    );
    const startContext: StartContext = {
      modules: new Map([
        [
          normalizeFilePath(sourceFile),
          {
            sourceFile,
            localBindings: new Map([["flow", { kind: "workflow", name: "order-flow" }]]),
            exports: new Map(),
          },
        ],
      ]),
    };

    await expect(bundle(sourceFile, { startContext })).resolves.toMatch(
      /startWorkflow\(.order-flow./,
    );
  });
});

describe("buildFunctionBundle cache", () => {
  test("rebuilds a cached bundle when a value its entry embeds changes", async () => {
    using tmp = tempCwd("sdk-function-bundle-cached-entry-");
    const sourceFile = writeFunction(tmp.dir, `export default async (value) => value;\n`);
    const cache = createBundleCache(createCacheStore({ cacheDir: path.join(tmp.dir, ".cache") }));
    const bundleEmbedding = (value: string) =>
      bundle(sourceFile, {
        cache,
        entry: (absoluteSourcePath) =>
          `import fn from "${absoluteSourcePath}";\n` +
          `export const main = () => fn(${JSON.stringify(value)});\n`,
      });

    expect(await bundleEmbedding("FIRST_VALUE")).toContain("FIRST_VALUE");
    expect(await bundleEmbedding("SECOND_VALUE")).toContain("SECOND_VALUE");
  });
});

describe("buildFunctionBundle inline sourcemaps", () => {
  async function embeddedSourceTexts(
    options: Partial<BuildFunctionBundleOptions>,
    dirPrefix: string,
  ): Promise<string[]> {
    using tmp = tempCwd(dirPrefix);
    const sourceFile = writeEncodingFunction(tmp.dir, "sourcemap-lib");
    const code = await bundle(sourceFile, {
      runtimeGlobals: { label: 'Function "fn"', allowed: { "sourcemap-lib": ["Buffer"] } },
      inlineSourcemap: true,
      ...options,
    });
    const traceMap = assertDefined(extractInlineSourcemap(code), "inline sourcemap missing");
    return (traceMap.sourcesContent ?? []).filter((text): text is string => text != null);
  }

  test("leaves out the source text of installed packages but keeps the project's own by default", async () => {
    const texts = await embeddedSourceTexts({}, "sdk-function-bundle-sourcemap-");

    expect(texts.some((text) => text.includes('toString("base64")'))).toBe(false);
    expect(texts.some((text) => text.includes("OWN_SOURCE"))).toBe(true);
  });

  test("embeds the source text of installed packages when asked to", async () => {
    const texts = await embeddedSourceTexts(
      { inlineSourcemapDependencySources: true },
      "sdk-function-bundle-sourcemap-with-deps-",
    );

    expect(texts.some((text) => text.includes('toString("base64")'))).toBe(true);
  });

  test("produces deterministic bundles", async () => {
    using tmp = tempCwd("sdk-function-bundle-sourcemap-deterministic-");
    const sourceFile = writeFunction(tmp.dir, `export default async () => "STABLE_MARKER";\n`);

    const first = await bundle(sourceFile, { inlineSourcemap: true });

    expect(first).toContain("STABLE_MARKER");
    expect(await bundle(sourceFile, { inlineSourcemap: true })).toBe(first);
  });
});
