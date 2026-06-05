import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createCacheManager } from "./manager";

vi.mock("@/cli/shared/logger", async (importOriginal) => ({
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

  describe("when disabled", () => {
    test("bundleCache.tryRestore always returns false", () => {
      const manager = createCacheManager({
        enabled: false,
        cacheDir,
        sdkVersion: "1.0.0",
      });

      const result = manager.bundleCache.tryRestore({
        kind: "resolver",
        name: "test",
      });

      expect(result).toBeUndefined();
    });

    test("bundleCache.save is a no-op", () => {
      const manager = createCacheManager({
        enabled: false,
        cacheDir,
        sdkVersion: "1.0.0",
      });

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
      const manager = createCacheManager({
        enabled: false,
        cacheDir,
        sdkVersion: "1.0.0",
      });

      // Should not throw and should not create any files
      manager.finalize();

      expect(fs.existsSync(cacheDir)).toBe(false);
    });

    test("enabled is false", () => {
      const manager = createCacheManager({
        enabled: false,
        cacheDir,
        sdkVersion: "1.0.0",
      });

      expect(manager.enabled).toBe(false);
    });
  });

  describe("when enabled", () => {
    test("enabled is true", () => {
      const manager = createCacheManager({
        enabled: true,
        cacheDir,
        sdkVersion: "1.0.0",
      });

      expect(manager.enabled).toBe(true);
    });

    test("enabled defaults to true when omitted", () => {
      const manager = createCacheManager({
        cacheDir,
        sdkVersion: "1.0.0",
      });

      expect(manager.enabled).toBe(true);
    });

    test("creates store and bundle cache", () => {
      const manager = createCacheManager({
        enabled: true,
        cacheDir,
        sdkVersion: "1.0.0",
      });

      // bundleCache should be a real BundleCache (not a no-op)
      expect(manager.bundleCache).toBeDefined();
      expect(manager.bundleCache.tryRestore).toBeTypeOf("function");
      expect(manager.bundleCache.save).toBeTypeOf("function");
    });

    test("finalize persists manifest with correct sdkVersion", () => {
      const manager = createCacheManager({
        enabled: true,
        cacheDir,
        sdkVersion: "2.5.0",
      });

      manager.finalize();

      // Read the manifest from disk and verify sdkVersion
      const manifestPath = path.join(cacheDir, "manifest.json");
      expect(fs.existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      expect(manifest.sdkVersion).toBe("2.5.0");
      expect(manifest.version).toBe(1);
    });

    test("finalize preserves entries added during the session", () => {
      const manager = createCacheManager({
        enabled: true,
        cacheDir,
        sdkVersion: "2.5.0",
      });

      // Create real files so hashing works
      const sourceFile = path.join(tmpDir, "src.ts");
      const outputFile = path.join(tmpDir, "out.js");
      fs.writeFileSync(sourceFile, "export const x = 1;");
      fs.writeFileSync(outputFile, "var x = 1;");

      // Add an entry via bundleCache.save()
      manager.bundleCache.save({
        kind: "resolver",
        name: "myResolver",
        sourceFile,
        content: "var x = 1;",
        dependencyPaths: [sourceFile],
      });

      // Finalize should persist the in-memory manifest (including the entry above)
      manager.finalize();

      // Read the manifest from disk and verify the entry is present
      const manifestPath = path.join(cacheDir, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      expect(manifest.sdkVersion).toBe("2.5.0");
      expect(manifest.entries["resolver:myResolver"]).toBeDefined();
      expect(manifest.entries["resolver:myResolver"].kind).toBe("bundle");
      expect(manifest.entries["resolver:myResolver"].dependencyPaths).toEqual([sourceFile]);
    });

    test("cache is preserved when sdkVersion matches", () => {
      // Pre-populate cache with a manifest and a bundle file
      fs.mkdirSync(path.join(cacheDir, "bundles"), { recursive: true });
      const manifest = {
        version: 1,
        sdkVersion: "1.0.0",
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
      fs.writeFileSync(path.join(cacheDir, "manifest.json"), JSON.stringify(manifest));
      fs.writeFileSync(path.join(cacheDir, "bundles", "resolver:test.js"), "cached output");

      // Create manager with the same sdkVersion
      createCacheManager({
        enabled: true,
        cacheDir,
        sdkVersion: "1.0.0",
      });

      // Cache directory and files should still exist
      expect(fs.existsSync(path.join(cacheDir, "bundles", "resolver:test.js"))).toBe(true);
      expect(fs.existsSync(path.join(cacheDir, "manifest.json"))).toBe(true);
    });

    test("cache is cleaned when sdkVersion differs", async () => {
      const { logger } = await import("@/cli/shared/logger");

      // Pre-populate cache with a manifest from an older SDK version
      fs.mkdirSync(path.join(cacheDir, "bundles"), { recursive: true });
      const manifest = {
        version: 1,
        sdkVersion: "1.0.0",
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
      fs.writeFileSync(path.join(cacheDir, "manifest.json"), JSON.stringify(manifest));
      fs.writeFileSync(path.join(cacheDir, "bundles", "resolver:test.js"), "cached output");

      // Create manager with a different sdkVersion
      createCacheManager({
        enabled: true,
        cacheDir,
        sdkVersion: "2.0.0",
      });

      // Cache should be wiped (directory removed by store.clean())
      expect(fs.existsSync(path.join(cacheDir, "bundles", "resolver:test.js"))).toBe(false);

      // Debug message should have been logged
      expect(logger.debug).toHaveBeenCalled();
    });

    /**
     * Write a manifest and a dummy bundle file into the cache directory.
     * @param overrides - Optional manifest fields to override defaults
     * @param overrides.lockfileHash - Lockfile hash to include in the manifest
     */
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
      fs.writeFileSync(path.join(cacheDir, "manifest.json"), JSON.stringify(manifest));
      fs.writeFileSync(path.join(cacheDir, "bundles", "resolver:test.js"), "cached output");
    }

    function expectBundleExists(exists: boolean): void {
      expect(fs.existsSync(path.join(cacheDir, "bundles", "resolver:test.js"))).toBe(exists);
    }

    test("cache is cleaned when lockfileHash differs", async () => {
      const { logger } = await import("@/cli/shared/logger");

      seedCache({ lockfileHash: "oldhash" });

      createCacheManager({
        enabled: true,
        cacheDir,
        sdkVersion: "1.0.0",
        lockfileHash: "newhash",
      });

      expectBundleExists(false);
      expect(logger.debug).toHaveBeenCalledWith("Cache invalidated: lockfile changed");
    });

    test("cache is preserved when lockfileHash matches", () => {
      seedCache({ lockfileHash: "samehash" });

      createCacheManager({
        enabled: true,
        cacheDir,
        sdkVersion: "1.0.0",
        lockfileHash: "samehash",
      });

      expectBundleExists(true);
    });

    test("cache is not invalidated when lockfileHash is not provided", () => {
      seedCache();

      createCacheManager({
        enabled: true,
        cacheDir,
        sdkVersion: "1.0.0",
      });

      expectBundleExists(true);
    });

    test("cache is cleaned when manifest has lockfileHash but options does not", async () => {
      const { logger } = await import("@/cli/shared/logger");

      seedCache({ lockfileHash: "existinghash" });

      createCacheManager({
        enabled: true,
        cacheDir,
        sdkVersion: "1.0.0",
      });

      expectBundleExists(false);
      expect(logger.debug).toHaveBeenCalledWith("Cache invalidated: lockfile changed");
    });

    test("finalize persists lockfileHash in manifest", () => {
      const manager = createCacheManager({
        enabled: true,
        cacheDir,
        sdkVersion: "2.5.0",
        lockfileHash: "abc123",
      });

      manager.finalize();

      const manifestPath = path.join(cacheDir, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      expect(manifest.lockfileHash).toBe("abc123");
    });
  });
});
