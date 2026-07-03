import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createCacheManager } from "./manager";

vi.mock("#/cli/shared/logger", async (importOriginal) => ({
  ...(await importOriginal()),
  logger: {
    debug: vi.fn(),
  },
}));

describe("createCacheManager", () => {
  let tmpDir: string;
  let cacheDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-manager-test-"));
    cacheDir = path.join(tmpDir, "cache");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeManager(overrides?: Partial<Parameters<typeof createCacheManager>[0]>) {
    return createCacheManager({ enabled: false, cacheDir, sdkVersion: "1.0.0", ...overrides });
  }

  function manifestPath() {
    return path.join(cacheDir, "manifest.json");
  }

  function readManifest() {
    return JSON.parse(fs.readFileSync(manifestPath(), "utf-8"));
  }

  function seedCache(overrides?: { lockfileHash?: string }): void {
    fs.mkdirSync(path.join(cacheDir, "bundles"), { recursive: true });
    const manifest = {
      version: 1,
      sdkVersion: "1.0.0",
      ...overrides,
      entries: {
        "resolver:test": {
          kind: "bundle",
          inputHash: "abc",
          dependencyPaths: [],
          outputFiles: [],
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      },
    };
    fs.writeFileSync(manifestPath(), JSON.stringify(manifest));
    fs.writeFileSync(path.join(cacheDir, "bundles", "resolver:test.js"), "cached output");
  }

  function expectBundleExists(exists: boolean): void {
    expect(fs.existsSync(path.join(cacheDir, "bundles", "resolver:test.js"))).toBe(exists);
  }

  describe("when disabled", () => {
    test("bundleCache.tryRestore always returns false", () => {
      const manager = makeManager();

      const result = manager.bundleCache.tryRestore({
        kind: "resolver",
        name: "test",
      });

      expect(result).toBeUndefined();
    });

    test("bundleCache.save is a no-op", () => {
      const manager = makeManager();

      expect(() =>
        manager.bundleCache.save({
          kind: "resolver",
          name: "test",
          sourceFile: "/tmp/src.ts",
          content: "bundled output",
          dependencyPaths: [],
        }),
      ).not.toThrow();
    });

    test("finalize is a no-op", () => {
      const manager = makeManager();

      manager.finalize();

      expect(fs.existsSync(cacheDir)).toBe(false);
    });

    test("enabled is false", () => {
      expect(makeManager().enabled).toBe(false);
    });
  });

  describe("when enabled", () => {
    test("enabled is true", () => {
      expect(makeManager({ enabled: true }).enabled).toBe(true);
    });

    test("enabled defaults to true when omitted", () => {
      const manager = createCacheManager({ cacheDir, sdkVersion: "1.0.0" });

      expect(manager.enabled).toBe(true);
    });

    test("creates store and bundle cache", () => {
      const manager = makeManager({ enabled: true });

      // bundleCache should be a real BundleCache (not a no-op)
      expect(manager.bundleCache).toBeDefined();
      expect(manager.bundleCache.tryRestore).toBeTypeOf("function");
      expect(manager.bundleCache.save).toBeTypeOf("function");
    });

    test("finalize persists manifest with correct sdkVersion", () => {
      const manager = makeManager({ enabled: true, sdkVersion: "2.5.0" });

      manager.finalize();

      expect(fs.existsSync(manifestPath())).toBe(true);
      const manifest = readManifest();
      expect(manifest.sdkVersion).toBe("2.5.0");
      expect(manifest.version).toBe(1);
    });

    test("finalize preserves entries added during the session", () => {
      const manager = makeManager({ enabled: true, sdkVersion: "2.5.0" });

      const sourceFile = path.join(tmpDir, "src.ts");
      const outputFile = path.join(tmpDir, "out.js");
      fs.writeFileSync(sourceFile, "export const x = 1;");
      fs.writeFileSync(outputFile, "var x = 1;");

      manager.bundleCache.save({
        kind: "resolver",
        name: "myResolver",
        sourceFile,
        content: "var x = 1;",
        dependencyPaths: [sourceFile],
      });

      manager.finalize();

      const manifest = readManifest();
      expect(manifest.sdkVersion).toBe("2.5.0");
      expect(manifest.entries["resolver:myResolver"]).toBeDefined();
      expect(manifest.entries["resolver:myResolver"].kind).toBe("bundle");
      expect(manifest.entries["resolver:myResolver"].dependencyPaths).toEqual([sourceFile]);
    });

    test("finalize preserves entries from another manager using the same cache directory", () => {
      const first = createCacheManager({
        enabled: true,
        cacheDir,
        sdkVersion: "2.5.0",
      });
      const second = createCacheManager({
        enabled: true,
        cacheDir,
        sdkVersion: "2.5.0",
      });
      const firstSource = path.join(tmpDir, "first.ts");
      const secondSource = path.join(tmpDir, "second.ts");
      fs.writeFileSync(firstSource, "export const first = 1;");
      fs.writeFileSync(secondSource, "export const second = 2;");

      first.bundleCache.save({
        kind: "resolver",
        name: "first",
        sourceFile: firstSource,
        content: "var first = 1;",
        dependencyPaths: [firstSource],
      });
      second.bundleCache.save({
        kind: "resolver",
        name: "second",
        sourceFile: secondSource,
        content: "var second = 2;",
        dependencyPaths: [secondSource],
      });
      first.finalize();
      second.finalize();

      const manifestPath = path.join(cacheDir, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      expect(Object.keys(manifest.entries).toSorted()).toEqual([
        "resolver:first",
        "resolver:second",
      ]);
    });

    test("cache is preserved when sdkVersion matches", () => {
      seedCache();

      makeManager({ enabled: true });

      expectBundleExists(true);
      expect(fs.existsSync(manifestPath())).toBe(true);
    });

    test("cache is cleaned when sdkVersion differs", async () => {
      const { logger } = await import("#/cli/shared/logger");
      seedCache();

      makeManager({ enabled: true, sdkVersion: "2.0.0" });

      expectBundleExists(false);
      expect(logger.debug).toHaveBeenCalled();
    });

    test("cache is cleaned when lockfileHash differs", async () => {
      const { logger } = await import("#/cli/shared/logger");
      seedCache({ lockfileHash: "oldhash" });

      makeManager({ enabled: true, lockfileHash: "newhash" });

      expectBundleExists(false);
      expect(logger.debug).toHaveBeenCalledWith("Cache invalidated: lockfile changed");
    });

    test("cache is preserved when lockfileHash matches", () => {
      seedCache({ lockfileHash: "samehash" });

      makeManager({ enabled: true, lockfileHash: "samehash" });

      expectBundleExists(true);
    });

    test("cache is not invalidated when lockfileHash is not provided", () => {
      seedCache();

      makeManager({ enabled: true });

      expectBundleExists(true);
    });

    test("cache is cleaned when manifest has lockfileHash but options does not", async () => {
      const { logger } = await import("#/cli/shared/logger");
      seedCache({ lockfileHash: "existinghash" });

      makeManager({ enabled: true });

      expectBundleExists(false);
      expect(logger.debug).toHaveBeenCalledWith("Cache invalidated: lockfile changed");
    });

    test("finalize persists lockfileHash in manifest", () => {
      const manager = makeManager({ enabled: true, sdkVersion: "2.5.0", lockfileHash: "abc123" });

      manager.finalize();

      expect(readManifest().lockfileHash).toBe("abc123");
    });
  });
});
