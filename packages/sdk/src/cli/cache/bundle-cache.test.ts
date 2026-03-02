import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { computeBundlerContextHash, createBundleCache, withCache } from "./bundle-cache";
import { createCacheStore } from "./store";

describe("createBundleCache", () => {
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

  describe("tryRestore", () => {
    test("returns false when no cache entry exists", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const outputPath = path.join(tmpDir, "dist", "resolver.js");

      const result = cache.tryRestore({
        kind: "resolver",
        name: "myResolver",
        outputPath,
      });

      expect(result).toBe(false);
    });

    test("returns false when input hash does not match (dependency changed)", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const sourceFile = writeFile("src/resolver.ts", "export default {}");
      const depFile = writeFile("src/utils.ts", "export const x = 1;");
      const outputPath = writeFile("dist/resolver.js", "bundled output");

      // Save initial cache
      cache.save({
        kind: "resolver",
        name: "myResolver",
        sourceFile,
        outputPath,
        dependencyPaths: [sourceFile, depFile],
      });

      // Modify a dependency
      fs.writeFileSync(depFile, "export const x = 2;");

      const result = cache.tryRestore({
        kind: "resolver",
        name: "myResolver",
        outputPath,
      });

      expect(result).toBe(false);
    });

    test("returns true and restores output when cache is valid", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const sourceFile = writeFile("src/resolver.ts", "export default {}");
      const depFile = writeFile("src/utils.ts", "export const x = 1;");
      const outputPath = writeFile("dist/resolver.js", "bundled output");

      // Save to cache
      cache.save({
        kind: "resolver",
        name: "myResolver",
        sourceFile,
        outputPath,
        dependencyPaths: [sourceFile, depFile],
      });

      // Remove the output file to simulate a clean build directory
      fs.unlinkSync(outputPath);
      expect(fs.existsSync(outputPath)).toBe(false);

      const result = cache.tryRestore({
        kind: "resolver",
        name: "myResolver",
        outputPath,
      });

      expect(result).toBe(true);
      // Output should be restored from cache
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.readFileSync(outputPath, "utf-8")).toBe("bundled output");
    });

    test("returns false when restoreBundleOutput fails", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const sourceFile = writeFile("src/resolver.ts", "export default {}");
      const outputPath = writeFile("dist/resolver.js", "bundled output");

      // Save to cache
      cache.save({
        kind: "resolver",
        name: "myResolver",
        sourceFile,
        outputPath,
        dependencyPaths: [sourceFile],
      });

      // Manually delete the cached bundle file to simulate a corrupted cache
      const bundlesDir = path.join(cacheDir, "bundles");
      fs.rmSync(bundlesDir, { recursive: true, force: true });

      const result = cache.tryRestore({
        kind: "resolver",
        name: "myResolver",
        outputPath,
      });

      expect(result).toBe(false);
    });

    test("returns false when a dependency file no longer exists", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const sourceFile = writeFile("src/resolver.ts", "export default {}");
      const depFile = writeFile("src/utils.ts", "export const x = 1;");
      const outputPath = writeFile("dist/resolver.js", "bundled output");

      // Save to cache
      cache.save({
        kind: "resolver",
        name: "myResolver",
        sourceFile,
        outputPath,
        dependencyPaths: [sourceFile, depFile],
      });

      // Delete a dependency file
      fs.unlinkSync(depFile);

      const result = cache.tryRestore({
        kind: "resolver",
        name: "myResolver",
        outputPath,
      });

      expect(result).toBe(false);
    });

    test("returns false when contextHash changes", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const sourceFile = writeFile("src/workflow.ts", "export default {}");
      const outputPath = writeFile("dist/workflow.js", "bundled output");

      cache.save({
        kind: "workflow-job",
        name: "myJob",
        sourceFile,
        outputPath,
        dependencyPaths: [sourceFile],
        contextHash: "env-hash-a",
      });

      const result = cache.tryRestore({
        kind: "workflow-job",
        name: "myJob",
        outputPath,
        contextHash: "env-hash-b",
      });

      expect(result).toBe(false);
    });

    test("returns false when contextHash is added after save without one", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const sourceFile = writeFile("src/workflow.ts", "export default {}");
      const outputPath = writeFile("dist/workflow.js", "bundled output");

      cache.save({
        kind: "workflow-job",
        name: "myJob",
        sourceFile,
        outputPath,
        dependencyPaths: [sourceFile],
      });

      const result = cache.tryRestore({
        kind: "workflow-job",
        name: "myJob",
        outputPath,
        contextHash: "env-hash-a",
      });

      expect(result).toBe(false);
    });

    test("returns true when contextHash matches", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const sourceFile = writeFile("src/workflow.ts", "export default {}");
      const outputPath = writeFile("dist/workflow.js", "bundled output");

      cache.save({
        kind: "workflow-job",
        name: "myJob",
        sourceFile,
        outputPath,
        dependencyPaths: [sourceFile],
        contextHash: "env-hash-a",
      });

      fs.unlinkSync(outputPath);

      const result = cache.tryRestore({
        kind: "workflow-job",
        name: "myJob",
        outputPath,
        contextHash: "env-hash-a",
      });

      expect(result).toBe(true);
      expect(fs.existsSync(outputPath)).toBe(true);
    });

    test("restores companion .map file on cache hit", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const sourceFile = writeFile("src/resolver.ts", "export default {}");
      const outputPath = writeFile("dist/resolver.js", "bundled output");
      writeFile("dist/resolver.js.map", '{"mappings":"AAAA"}');

      cache.save({
        kind: "resolver",
        name: "myResolver",
        sourceFile,
        outputPath,
        dependencyPaths: [sourceFile],
      });

      // Remove both output files to simulate clean build directory
      fs.unlinkSync(outputPath);
      fs.unlinkSync(`${outputPath}.map`);

      const result = cache.tryRestore({
        kind: "resolver",
        name: "myResolver",
        outputPath,
      });

      expect(result).toBe(true);
      expect(fs.readFileSync(outputPath, "utf-8")).toBe("bundled output");
      expect(fs.readFileSync(`${outputPath}.map`, "utf-8")).toBe('{"mappings":"AAAA"}');
    });
  });

  describe("save", () => {
    test("stores bundle output and creates cache entry", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const sourceFile = writeFile("src/executor.ts", "export default {}");
      const depFile = writeFile("src/helper.ts", "export function help() {}");
      const outputPath = writeFile("dist/executor.js", "bundled executor");

      cache.save({
        kind: "executor",
        name: "myExecutor",
        sourceFile,
        outputPath,
        dependencyPaths: [sourceFile, depFile],
      });

      // Verify cache entry was created
      const entry = store.getEntry("executor:myExecutor");
      expect(entry).toBeDefined();
      expect(entry?.kind).toBe("bundle");
      expect(entry?.dependencyPaths).toEqual(expect.arrayContaining([sourceFile, depFile]));
      expect(entry?.inputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry?.outputFiles).toHaveLength(1);
      expect(entry?.outputFiles[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);

      // Verify bundle output is stored in cache (colon replaced with underscore in filename)
      const cachedBundlePath = path.join(cacheDir, "bundles", "executor_myExecutor.js");
      expect(fs.existsSync(cachedBundlePath)).toBe(true);
      expect(fs.readFileSync(cachedBundlePath, "utf-8")).toBe("bundled executor");
    });

    test("updates existing cache entry on re-save", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const sourceFile = writeFile("src/workflow.ts", "export default {}");
      const outputPath = writeFile("dist/workflow.js", "bundled v1");

      // First save
      cache.save({
        kind: "workflow-job",
        name: "myJob",
        sourceFile,
        outputPath,
        dependencyPaths: [sourceFile],
      });

      const firstEntry = store.getEntry("workflow-job:myJob");
      expect(firstEntry).toBeDefined();
      const firstInputHash = firstEntry?.inputHash;

      // Modify source and output
      fs.writeFileSync(sourceFile, "export default { updated: true }");
      fs.writeFileSync(outputPath, "bundled v2");

      // Re-save
      cache.save({
        kind: "workflow-job",
        name: "myJob",
        sourceFile,
        outputPath,
        dependencyPaths: [sourceFile],
      });

      const secondEntry = store.getEntry("workflow-job:myJob");
      expect(secondEntry).toBeDefined();
      // Input hash should differ because source changed
      expect(secondEntry?.inputHash).not.toBe(firstInputHash);
    });
  });

  describe("cache key format", () => {
    test("cache key is kind:name", () => {
      const store = createCacheStore({ cacheDir });
      const cache = createBundleCache(store);
      const sourceFile = writeFile("src/resolver.ts", "export default {}");
      const outputPath = writeFile("dist/resolver.js", "bundled");

      cache.save({
        kind: "resolver",
        name: "getUser",
        sourceFile,
        outputPath,
        dependencyPaths: [sourceFile],
      });

      expect(store.getEntry("resolver:getUser")).toBeDefined();
      // Other keys should not exist
      expect(store.getEntry("getUser")).toBeUndefined();
      expect(store.getEntry("resolver")).toBeUndefined();
    });
  });
});

describe("withCache", () => {
  let tmpDir: string;
  let cacheDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "with-cache-test-"));
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

  test("calls build directly when cache is undefined", async () => {
    const build = vi.fn();
    await withCache({
      cache: undefined,
      kind: "resolver",
      name: "myResolver",
      sourceFile: "/tmp/src.ts",
      outputPath: "/tmp/out.js",
      contextHash: undefined,
      build,
    });

    expect(build).toHaveBeenCalledOnce();
    expect(build).toHaveBeenCalledWith([]);
  });

  test("skips build when cache restores successfully", async () => {
    const store = createCacheStore({ cacheDir });
    const cache = createBundleCache(store);
    const sourceFile = writeFile("src/resolver.ts", "export default {}");
    const outputPath = writeFile("dist/resolver.js", "bundled output");

    // Pre-populate cache
    cache.save({
      kind: "resolver",
      name: "myResolver",
      sourceFile,
      outputPath,
      dependencyPaths: [sourceFile],
    });

    const build = vi.fn();
    await withCache({
      cache,
      kind: "resolver",
      name: "myResolver",
      sourceFile,
      outputPath,
      contextHash: undefined,
      build,
    });

    expect(build).not.toHaveBeenCalled();
  });

  test("calls build and saves to cache on cache miss", async () => {
    const store = createCacheStore({ cacheDir });
    const cache = createBundleCache(store);
    const sourceFile = writeFile("src/resolver.ts", "export default {}");
    const outputPath = path.join(tmpDir, "dist", "resolver.js");

    const build = vi.fn(async () => {
      // Simulate build producing an output file
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, "built output");
    });

    await withCache({
      cache,
      kind: "resolver",
      name: "myResolver",
      sourceFile,
      outputPath,
      contextHash: undefined,
      build,
    });

    expect(build).toHaveBeenCalledOnce();
    // build receives an array containing the dep-collector plugin
    const firstCallArgs = build.mock.calls[0] as unknown[];
    expect(firstCallArgs?.[0]).toHaveLength(1);
    // Cache entry should exist after save
    expect(store.getEntry("resolver:myResolver")).toBeDefined();
  });

  test("passes contextHash through to tryRestore and save", async () => {
    const store = createCacheStore({ cacheDir });
    const cache = createBundleCache(store);
    const sourceFile = writeFile("src/job.ts", "export default {}");
    const outputPath = path.join(tmpDir, "dist", "job.js");

    const build = vi.fn(async () => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, "built output");
    });

    // First call: cache miss, should build and save with contextHash
    await withCache({
      cache,
      kind: "workflow-job",
      name: "myJob",
      sourceFile,
      outputPath,
      contextHash: "hash-a",
      build,
    });
    expect(build).toHaveBeenCalledOnce();

    // Second call with same contextHash: should hit cache
    build.mockClear();
    await withCache({
      cache,
      kind: "workflow-job",
      name: "myJob",
      sourceFile,
      outputPath,
      contextHash: "hash-a",
      build,
    });
    expect(build).not.toHaveBeenCalled();

    // Third call with different contextHash: should miss cache
    build.mockClear();
    build.mockImplementation(async () => {
      fs.writeFileSync(outputPath, "rebuilt output");
    });
    await withCache({
      cache,
      kind: "workflow-job",
      name: "myJob",
      sourceFile,
      outputPath,
      contextHash: "hash-b",
      build,
    });
    expect(build).toHaveBeenCalledOnce();
  });
});

describe("computeBundlerContextHash", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-hash-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTsconfig(content: string): string {
    const filePath = path.join(tmpDir, "tsconfig.json");
    fs.writeFileSync(filePath, content);
    return filePath;
  }

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

  test("returns different hash when sourceFile differs", () => {
    const a = computeBundlerContextHash(baseParams);
    const b = computeBundlerContextHash({ ...baseParams, sourceFile: "/tmp/src/executor.ts" });

    expect(a).not.toBe(b);
  });

  test("returns different hash when serializedTriggerContext differs", () => {
    const a = computeBundlerContextHash(baseParams);
    const b = computeBundlerContextHash({ ...baseParams, serializedTriggerContext: "other" });

    expect(a).not.toBe(b);
  });

  test("returns different hash when tsconfig content differs", () => {
    const tsconfig1 = writeTsconfig('{"compilerOptions": {"strict": true}}');
    const tsconfig2Path = path.join(tmpDir, "tsconfig2.json");
    fs.writeFileSync(tsconfig2Path, '{"compilerOptions": {"strict": false}}');

    const a = computeBundlerContextHash({ ...baseParams, tsconfig: tsconfig1 });
    const b = computeBundlerContextHash({ ...baseParams, tsconfig: tsconfig2Path });

    expect(a).not.toBe(b);
  });

  test("returns different hash when tsconfig is undefined vs specified", () => {
    const tsconfig = writeTsconfig('{"compilerOptions": {}}');

    const a = computeBundlerContextHash(baseParams);
    const b = computeBundlerContextHash({ ...baseParams, tsconfig });

    expect(a).not.toBe(b);
  });

  test("returns different hash when prefix differs", () => {
    const a = computeBundlerContextHash({ ...baseParams, prefix: "ENV_A=1" });
    const b = computeBundlerContextHash({ ...baseParams, prefix: "ENV_B=2" });

    expect(a).not.toBe(b);
  });

  test("returns same hash when prefix is undefined vs empty string", () => {
    const a = computeBundlerContextHash({ ...baseParams, prefix: undefined });
    const b = computeBundlerContextHash({ ...baseParams, prefix: "" });

    expect(a).toBe(b);
  });
});
