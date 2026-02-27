import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createBundleCache } from "./bundle-cache";
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
      const store = createCacheStore({ enabled: true, cacheDir });
      const cache = createBundleCache(store, "1.0.0");
      const sourceFile = writeFile("src/resolver.ts", "export default {}");
      const outputPath = path.join(tmpDir, "dist", "resolver.js");

      const result = cache.tryRestore({
        kind: "resolver",
        name: "myResolver",
        sourceFile,
        outputPath,
      });

      expect(result).toBe(false);
    });

    test("returns false when input hash does not match (dependency changed)", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const cache = createBundleCache(store, "1.0.0");
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
        sourceFile,
        outputPath,
      });

      expect(result).toBe(false);
    });

    test("returns true and restores output when cache is valid", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const cache = createBundleCache(store, "1.0.0");
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
        sourceFile,
        outputPath,
      });

      expect(result).toBe(true);
      // Output should be restored from cache
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.readFileSync(outputPath, "utf-8")).toBe("bundled output");
    });

    test("returns false when restoreBundleOutput fails", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const cache = createBundleCache(store, "1.0.0");
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
        sourceFile,
        outputPath,
      });

      expect(result).toBe(false);
    });

    test("returns false when a dependency file no longer exists", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const cache = createBundleCache(store, "1.0.0");
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
        sourceFile,
        outputPath,
      });

      expect(result).toBe(false);
    });
  });

  describe("save", () => {
    test("stores bundle output and creates cache entry", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const cache = createBundleCache(store, "1.0.0");
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

      // Verify bundle output is stored in cache
      const cachedBundlePath = path.join(cacheDir, "bundles", "executor:myExecutor.js");
      expect(fs.existsSync(cachedBundlePath)).toBe(true);
      expect(fs.readFileSync(cachedBundlePath, "utf-8")).toBe("bundled executor");
    });

    test("updates existing cache entry on re-save", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const cache = createBundleCache(store, "1.0.0");
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
      const store = createCacheStore({ enabled: true, cacheDir });
      const cache = createBundleCache(store, "1.0.0");
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
