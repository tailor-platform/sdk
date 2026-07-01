import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { computeBundlerContextHash, createBundleCache, withCache } from "./bundle-cache";
import { createCacheStore } from "./store";

let tmpDir: string;
let cacheDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-cache-test-"));
  cacheDir = path.join(tmpDir, "cache");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe("createBundleCache", () => {
  describe("tryRestore", () => {
    test("returns undefined when no cache entry exists", () => {
      const cache = createBundleCache(createCacheStore({ cacheDir }));

      const result = cache.tryRestore({ kind: "resolver", name: "myResolver" });

      expect(result).toBeUndefined();
    });

    test("returns undefined when input hash does not match (dependency changed)", () => {
      const cache = createBundleCache(createCacheStore({ cacheDir }));
      const sourceFile = writeFile("src/resolver.ts", "export default {}");
      const depFile = writeFile("src/utils.ts", "export const x = 1;");
      cache.save({
        kind: "resolver",
        name: "myResolver",
        sourceFile,
        content: "bundled output",
        dependencyPaths: [sourceFile, depFile],
      });

      fs.writeFileSync(depFile, "export const x = 2;");
      const result = cache.tryRestore({ kind: "resolver", name: "myResolver" });

      expect(result).toBeUndefined();
    });

    test("returns content string when cache is valid", () => {
      const cache = createBundleCache(createCacheStore({ cacheDir }));
      const sourceFile = writeFile("src/resolver.ts", "export default {}");
      const depFile = writeFile("src/utils.ts", "export const x = 1;");
      cache.save({
        kind: "resolver",
        name: "myResolver",
        sourceFile,
        content: "bundled output",
        dependencyPaths: [sourceFile, depFile],
      });

      const result = cache.tryRestore({ kind: "resolver", name: "myResolver" });

      expect(result).toBe("bundled output");
    });

    test("returns undefined when cached bundle file is missing", () => {
      const cache = createBundleCache(createCacheStore({ cacheDir }));
      const sourceFile = writeFile("src/resolver.ts", "export default {}");
      cache.save({
        kind: "resolver",
        name: "myResolver",
        sourceFile,
        content: "bundled output",
        dependencyPaths: [sourceFile],
      });

      fs.rmSync(path.join(cacheDir, "bundles"), { recursive: true, force: true });
      const result = cache.tryRestore({ kind: "resolver", name: "myResolver" });

      expect(result).toBeUndefined();
    });

    test("returns undefined when a dependency file no longer exists", () => {
      const cache = createBundleCache(createCacheStore({ cacheDir }));
      const sourceFile = writeFile("src/resolver.ts", "export default {}");
      const depFile = writeFile("src/utils.ts", "export const x = 1;");
      cache.save({
        kind: "resolver",
        name: "myResolver",
        sourceFile,
        content: "bundled output",
        dependencyPaths: [sourceFile, depFile],
      });

      fs.unlinkSync(depFile);
      const result = cache.tryRestore({ kind: "resolver", name: "myResolver" });

      expect(result).toBeUndefined();
    });

    test("returns undefined when contextHash changes", () => {
      const cache = createBundleCache(createCacheStore({ cacheDir }));
      const sourceFile = writeFile("src/workflow.ts", "export default {}");
      cache.save({
        kind: "workflow-job",
        name: "myJob",
        sourceFile,
        content: "bundled output",
        dependencyPaths: [sourceFile],
        contextHash: "env-hash-a",
      });

      const result = cache.tryRestore({
        kind: "workflow-job",
        name: "myJob",
        contextHash: "env-hash-b",
      });

      expect(result).toBeUndefined();
    });

    test("returns undefined when contextHash is added after save without one", () => {
      const cache = createBundleCache(createCacheStore({ cacheDir }));
      const sourceFile = writeFile("src/workflow.ts", "export default {}");
      cache.save({
        kind: "workflow-job",
        name: "myJob",
        sourceFile,
        content: "bundled output",
        dependencyPaths: [sourceFile],
      });

      const result = cache.tryRestore({
        kind: "workflow-job",
        name: "myJob",
        contextHash: "env-hash-a",
      });

      expect(result).toBeUndefined();
    });

    test("returns content when contextHash matches", () => {
      const cache = createBundleCache(createCacheStore({ cacheDir }));
      const sourceFile = writeFile("src/workflow.ts", "export default {}");
      cache.save({
        kind: "workflow-job",
        name: "myJob",
        sourceFile,
        content: "bundled output",
        dependencyPaths: [sourceFile],
        contextHash: "env-hash-a",
      });

      const result = cache.tryRestore({
        kind: "workflow-job",
        name: "myJob",
        contextHash: "env-hash-a",
      });

      expect(result).toBe("bundled output");
    });
  });

  describe("save", () => {
    test("stores bundle content and creates cache entry", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const sourceFile = writeFile("src/executor.ts", "export default {}");
      const depFile = writeFile("src/helper.ts", "export function help() {}");

      cache.save({
        kind: "executor",
        name: "myExecutor",
        sourceFile,
        content: "bundled executor",
        dependencyPaths: [sourceFile, depFile],
      });

      const entry = store.getEntry("executor:myExecutor");
      expect(entry).toBeDefined();
      expect(entry?.kind).toBe("bundle");
      expect(entry?.dependencyPaths).toEqual(expect.arrayContaining([sourceFile, depFile]));
      expect(entry?.inputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry?.outputFiles).toHaveLength(1);
      expect(entry?.outputFiles[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);

      // Cache filename replaces the ":" in "kind:name" with "_"
      const cachedBundlePath = path.join(cacheDir, "bundles", "executor_myExecutor.js");
      expect(fs.existsSync(cachedBundlePath)).toBe(true);
      expect(fs.readFileSync(cachedBundlePath, "utf-8")).toBe("bundled executor");
    });

    test("updates existing cache entry on re-save", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const sourceFile = writeFile("src/workflow.ts", "export default {}");

      cache.save({
        kind: "workflow-job",
        name: "myJob",
        sourceFile,
        content: "bundled v1",
        dependencyPaths: [sourceFile],
      });
      const firstInputHash = store.getEntry("workflow-job:myJob")?.inputHash;
      expect(firstInputHash).toBeDefined();

      fs.writeFileSync(sourceFile, "export default { updated: true }");
      cache.save({
        kind: "workflow-job",
        name: "myJob",
        sourceFile,
        content: "bundled v2",
        dependencyPaths: [sourceFile],
      });

      const secondEntry = store.getEntry("workflow-job:myJob");
      expect(secondEntry).toBeDefined();
      expect(secondEntry?.inputHash).not.toBe(firstInputHash);
    });
  });

  describe("cache key format", () => {
    test("cache key is kind:name", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const sourceFile = writeFile("src/resolver.ts", "export default {}");

      cache.save({
        kind: "resolver",
        name: "getUser",
        sourceFile,
        content: "bundled",
        dependencyPaths: [sourceFile],
      });

      expect(store.getEntry("resolver:getUser")).toBeDefined();
      expect(store.getEntry("getUser")).toBeUndefined();
      expect(store.getEntry("resolver")).toBeUndefined();
    });
  });
});

describe("withCache", () => {
  test("calls build directly when cache is undefined", async () => {
    const build = vi.fn(async () => "built output");
    const result = await withCache({
      cache: undefined,
      kind: "resolver",
      name: "myResolver",
      sourceFile: "/tmp/src.ts",
      contextHash: undefined,
      build,
    });

    expect(build).toHaveBeenCalledOnce();
    expect(build).toHaveBeenCalledWith([]);
    expect(result).toBe("built output");
  });

  test("skips build when cache restores successfully", async () => {
    const cache = createBundleCache(createCacheStore({ cacheDir }));
    const sourceFile = writeFile("src/resolver.ts", "export default {}");
    cache.save({
      kind: "resolver",
      name: "myResolver",
      sourceFile,
      content: "bundled output",
      dependencyPaths: [sourceFile],
    });

    const build = vi.fn(async () => "should not be called");
    const result = await withCache({
      cache,
      kind: "resolver",
      name: "myResolver",
      sourceFile,
      contextHash: undefined,
      build,
    });

    expect(build).not.toHaveBeenCalled();
    expect(result).toBe("bundled output");
  });

  test("calls build and saves to cache on cache miss", async () => {
    const store = createCacheStore({ cacheDir });
    const cache = createBundleCache(store);
    const sourceFile = writeFile("src/resolver.ts", "export default {}");
    const build = vi.fn(async () => "built output");

    const result = await withCache({
      cache,
      kind: "resolver",
      name: "myResolver",
      sourceFile,
      contextHash: undefined,
      build,
    });

    expect(build).toHaveBeenCalledOnce();
    // build receives an array containing the dep-collector plugin
    const firstCallArgs = build.mock.calls[0] as unknown[];
    expect(firstCallArgs[0]).toHaveLength(1);
    expect(store.getEntry("resolver:myResolver")).toBeDefined();
    expect(result).toBe("built output");
  });

  test("passes contextHash through to tryRestore and save", async () => {
    const cache = createBundleCache(createCacheStore({ cacheDir }));
    const sourceFile = writeFile("src/job.ts", "export default {}");
    const build = vi.fn(async () => "built output");

    await withCache({
      cache,
      kind: "workflow-job",
      name: "myJob",
      sourceFile,
      contextHash: "hash-a",
      build,
    });
    expect(build).toHaveBeenCalledOnce();

    build.mockClear();
    const result = await withCache({
      cache,
      kind: "workflow-job",
      name: "myJob",
      sourceFile,
      contextHash: "hash-a",
      build,
    });
    expect(build).not.toHaveBeenCalled();
    expect(result).toBe("built output");

    build.mockClear();
    build.mockImplementation(async () => "rebuilt output");
    await withCache({
      cache,
      kind: "workflow-job",
      name: "myJob",
      sourceFile,
      contextHash: "hash-b",
      build,
    });
    expect(build).toHaveBeenCalledOnce();
  });
});

describe("computeBundlerContextHash", () => {
  const baseParams = {
    sourceFile: "/tmp/src/resolver.ts",
    serializedTriggerContext: "ctx",
  };

  test("returns the same hash for identical inputs", () => {
    const a = computeBundlerContextHash(baseParams);
    const b = computeBundlerContextHash(baseParams);

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test.each([
    ["sourceFile", {}, { sourceFile: "/tmp/src/executor.ts" }],
    ["serializedTriggerContext", {}, { serializedTriggerContext: "other" }],
    ["prefix", { prefix: "ENV_A=1" }, { prefix: "ENV_B=2" }],
    ["bundleLogLevel", { bundleLogLevel: "DEBUG" }, { bundleLogLevel: "WARN" }],
  ])("returns different hash when %s differs", (_label, overrideA, overrideB) => {
    const a = computeBundlerContextHash({ ...baseParams, ...overrideA });
    const b = computeBundlerContextHash({ ...baseParams, ...overrideB });

    expect(a).not.toBe(b);
  });

  test("returns different hash when tsconfig content differs", () => {
    const tsconfig1 = writeFile("tsconfig.json", '{"compilerOptions": {"strict": true}}');
    const tsconfig2 = writeFile("tsconfig2.json", '{"compilerOptions": {"strict": false}}');

    const a = computeBundlerContextHash({ ...baseParams, tsconfig: tsconfig1 });
    const b = computeBundlerContextHash({ ...baseParams, tsconfig: tsconfig2 });

    expect(a).not.toBe(b);
  });

  test("returns different hash when tsconfig is undefined vs specified", () => {
    const tsconfig = writeFile("tsconfig.json", '{"compilerOptions": {}}');

    const a = computeBundlerContextHash(baseParams);
    const b = computeBundlerContextHash({ ...baseParams, tsconfig });

    expect(a).not.toBe(b);
  });

  test("returns same hash when prefix is undefined vs empty string", () => {
    const a = computeBundlerContextHash({ ...baseParams, prefix: undefined });
    const b = computeBundlerContextHash({ ...baseParams, prefix: "" });

    expect(a).toBe(b);
  });
});
