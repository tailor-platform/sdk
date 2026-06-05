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
      outputFiles: [{ outputPath: "dist/index.js", contentHash: "def456" }],
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
      const store = createCacheStore({ cacheDir });
      expect(store.loadManifest()).toBeUndefined();
    });

    test("returns undefined for corrupted JSON", () => {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, "manifest.json"), "not valid json{{{");

      const store = createCacheStore({ cacheDir });
      expect(store.loadManifest()).toBeUndefined();
    });

    test("returns undefined for wrong version", () => {
      fs.mkdirSync(cacheDir, { recursive: true });
      const badManifest = { version: 999, sdkVersion: "1.0.0", entries: {} };
      fs.writeFileSync(path.join(cacheDir, "manifest.json"), JSON.stringify(badManifest));

      const store = createCacheStore({ cacheDir });
      expect(store.loadManifest()).toBeUndefined();
    });

    test("returns manifest for valid file", () => {
      fs.mkdirSync(cacheDir, { recursive: true });
      const manifest = makeManifest({ myKey: makeEntry() });
      fs.writeFileSync(path.join(cacheDir, "manifest.json"), JSON.stringify(manifest));

      const store = createCacheStore({ cacheDir });
      expect(store.loadManifest()).toEqual(manifest);
    });
  });

  describe("saveManifest", () => {
    test("writes valid JSON that loadManifest can read back", () => {
      const store = createCacheStore({ cacheDir });
      const manifest = makeManifest({ key1: makeEntry() });

      store.saveManifest(manifest);

      // Create a new store to avoid in-memory cache
      const store2 = createCacheStore({ cacheDir });
      expect(store2.loadManifest()).toEqual(manifest);
    });

    test("creates cache directory if it does not exist", () => {
      const store = createCacheStore({ cacheDir });
      const manifest = makeManifest();

      store.saveManifest(manifest);

      expect(fs.existsSync(cacheDir)).toBe(true);
    });

    test("atomic write produces always-valid JSON on disk", () => {
      const store = createCacheStore({ cacheDir });
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
      const store = createCacheStore({ cacheDir });
      expect(store.getEntry("nonexistent")).toBeUndefined();
    });

    test("setEntry stores and getEntry retrieves an entry", () => {
      const store = createCacheStore({ cacheDir });
      const entry = makeEntry();

      store.setEntry("myKey", entry);

      expect(store.getEntry("myKey")).toEqual(entry);
    });

    test("deleteEntry removes an entry", () => {
      const store = createCacheStore({ cacheDir });
      const entry = makeEntry();

      store.setEntry("myKey", entry);
      store.deleteEntry("myKey");

      expect(store.getEntry("myKey")).toBeUndefined();
    });

    test("deleteEntry is a no-op for non-existent key", () => {
      const store = createCacheStore({ cacheDir });

      expect(() => store.deleteEntry("nonexistent")).not.toThrow();
    });

    test("entries persist through saveManifest and loadManifest cycle", () => {
      const store = createCacheStore({ cacheDir });
      const entry = makeEntry();
      const manifest = makeManifest({ myKey: entry });

      store.saveManifest(manifest);

      // New store reads persisted data
      const store2 = createCacheStore({ cacheDir });
      expect(store2.loadManifest()).toEqual(manifest);
      expect(store2.getEntry("myKey")).toEqual(entry);
    });
  });

  describe("clean", () => {
    test("removes entire cache directory", () => {
      const store = createCacheStore({ cacheDir });
      const manifest = makeManifest({ key1: makeEntry() });
      store.saveManifest(manifest);

      store.storeBundleContent("key1", "code");

      // Verify cache dir exists
      expect(fs.existsSync(cacheDir)).toBe(true);

      store.clean();

      expect(fs.existsSync(cacheDir)).toBe(false);
    });

    test("is a no-op when cache directory does not exist", () => {
      const store = createCacheStore({ cacheDir });

      // Should not throw
      store.clean();

      expect(fs.existsSync(cacheDir)).toBe(false);
    });
  });
});
