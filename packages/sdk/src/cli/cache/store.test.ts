import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createCacheStore } from "./store";
import type { CacheEntry, CacheManifest } from "./types";

describe("createCacheStore", () => {
  let tmpDir: string;
  let cacheDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-store-test-"));
    cacheDir = path.join(tmpDir, "cache");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeEntry(overrides: Partial<CacheEntry> = {}): CacheEntry {
    return {
      kind: "bundle",
      inputHash: "abc123",
      dependencyPaths: ["/src/index.ts"],
      outputFiles: [{ relativePath: "dist/index.js", contentHash: "def456" }],
      createdAt: "2025-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  function makeManifest(entries: Record<string, CacheEntry> = {}): CacheManifest {
    return {
      version: 1,
      sdkVersion: "1.0.0",
      entries,
    };
  }

  describe("loadManifest", () => {
    test("returns undefined when no manifest exists", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      expect(store.loadManifest()).toBeUndefined();
    });

    test("returns undefined for corrupted JSON", () => {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, "manifest.json"), "not valid json{{{");

      const store = createCacheStore({ enabled: true, cacheDir });
      expect(store.loadManifest()).toBeUndefined();
    });

    test("returns undefined for wrong version", () => {
      fs.mkdirSync(cacheDir, { recursive: true });
      const badManifest = { version: 999, sdkVersion: "1.0.0", entries: {} };
      fs.writeFileSync(path.join(cacheDir, "manifest.json"), JSON.stringify(badManifest));

      const store = createCacheStore({ enabled: true, cacheDir });
      expect(store.loadManifest()).toBeUndefined();
    });

    test("returns manifest for valid file", () => {
      fs.mkdirSync(cacheDir, { recursive: true });
      const manifest = makeManifest({ myKey: makeEntry() });
      fs.writeFileSync(path.join(cacheDir, "manifest.json"), JSON.stringify(manifest));

      const store = createCacheStore({ enabled: true, cacheDir });
      expect(store.loadManifest()).toEqual(manifest);
    });
  });

  describe("saveManifest", () => {
    test("writes valid JSON that loadManifest can read back", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const manifest = makeManifest({ key1: makeEntry() });

      store.saveManifest(manifest);

      // Create a new store to avoid in-memory cache
      const store2 = createCacheStore({ enabled: true, cacheDir });
      expect(store2.loadManifest()).toEqual(manifest);
    });

    test("creates cache directory if it does not exist", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const manifest = makeManifest();

      store.saveManifest(manifest);

      expect(fs.existsSync(cacheDir)).toBe(true);
    });

    test("atomic write produces always-valid JSON on disk", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const manifest = makeManifest({ key1: makeEntry() });

      store.saveManifest(manifest);

      // Verify file content is always valid JSON (no partial writes)
      const content = fs.readFileSync(path.join(cacheDir, "manifest.json"), "utf-8");
      expect(() => JSON.parse(content)).not.toThrow();
      expect(JSON.parse(content)).toEqual(manifest);
    });
  });

  describe("getEntry / setEntry / deleteEntry", () => {
    test("getEntry returns undefined for non-existent key", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      expect(store.getEntry("nonexistent")).toBeUndefined();
    });

    test("setEntry stores and getEntry retrieves an entry", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const entry = makeEntry();

      store.setEntry("myKey", entry);

      expect(store.getEntry("myKey")).toEqual(entry);
    });

    test("deleteEntry removes an entry", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const entry = makeEntry();

      store.setEntry("myKey", entry);
      store.deleteEntry("myKey");

      expect(store.getEntry("myKey")).toBeUndefined();
    });

    test("deleteEntry is a no-op for non-existent key", () => {
      const store = createCacheStore({ enabled: true, cacheDir });

      // Should not throw
      store.deleteEntry("nonexistent");
    });

    test("entries persist through saveManifest and loadManifest cycle", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const entry = makeEntry();
      const manifest = makeManifest({ myKey: entry });

      store.saveManifest(manifest);

      // New store reads persisted data
      const store2 = createCacheStore({ enabled: true, cacheDir });
      expect(store2.loadManifest()).toEqual(manifest);
      expect(store2.getEntry("myKey")).toEqual(entry);
    });
  });

  describe("storeBundleOutput", () => {
    test("copies file to cache/bundles/ directory", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const sourceFile = path.join(tmpDir, "output.js");
      fs.writeFileSync(sourceFile, "console.log('hello');");

      store.storeBundleOutput("myBundle", sourceFile);

      const cachedPath = path.join(cacheDir, "bundles", "myBundle.js");
      expect(fs.existsSync(cachedPath)).toBe(true);
      expect(fs.readFileSync(cachedPath, "utf-8")).toBe("console.log('hello');");
    });

    test("creates bundles directory if it does not exist", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const sourceFile = path.join(tmpDir, "output.js");
      fs.writeFileSync(sourceFile, "code");

      store.storeBundleOutput("key1", sourceFile);

      expect(fs.existsSync(path.join(cacheDir, "bundles"))).toBe(true);
    });
  });

  describe("restoreBundleOutput", () => {
    test("copies file from cache/bundles/ to target path", () => {
      const store = createCacheStore({ enabled: true, cacheDir });

      // First store a bundle
      const sourceFile = path.join(tmpDir, "output.js");
      fs.writeFileSync(sourceFile, "console.log('restored');");
      store.storeBundleOutput("myBundle", sourceFile);

      // Now restore it to a different location
      const targetFile = path.join(tmpDir, "restored", "output.js");
      const result = store.restoreBundleOutput("myBundle", targetFile);

      expect(result).toBe(true);
      expect(fs.readFileSync(targetFile, "utf-8")).toBe("console.log('restored');");
    });

    test("creates target directory if it does not exist", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const sourceFile = path.join(tmpDir, "output.js");
      fs.writeFileSync(sourceFile, "code");
      store.storeBundleOutput("myBundle", sourceFile);

      const targetFile = path.join(tmpDir, "deeply", "nested", "dir", "output.js");
      store.restoreBundleOutput("myBundle", targetFile);

      expect(fs.existsSync(path.join(tmpDir, "deeply", "nested", "dir"))).toBe(true);
    });

    test("returns false when cache file does not exist", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const targetFile = path.join(tmpDir, "target.js");

      const result = store.restoreBundleOutput("nonexistent", targetFile);

      expect(result).toBe(false);
      expect(fs.existsSync(targetFile)).toBe(false);
    });
  });

  describe("clean", () => {
    test("removes entire cache directory", () => {
      const store = createCacheStore({ enabled: true, cacheDir });
      const manifest = makeManifest({ key1: makeEntry() });
      store.saveManifest(manifest);

      const sourceFile = path.join(tmpDir, "output.js");
      fs.writeFileSync(sourceFile, "code");
      store.storeBundleOutput("key1", sourceFile);

      // Verify cache dir exists
      expect(fs.existsSync(cacheDir)).toBe(true);

      store.clean();

      expect(fs.existsSync(cacheDir)).toBe(false);
    });

    test("is a no-op when cache directory does not exist", () => {
      const store = createCacheStore({ enabled: true, cacheDir });

      // Should not throw
      store.clean();

      expect(fs.existsSync(cacheDir)).toBe(false);
    });
  });
});
