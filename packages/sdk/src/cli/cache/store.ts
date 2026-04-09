import * as fs from "node:fs";
import * as path from "pathe";
import { cacheManifestSchema } from "./types";
import type { CacheConfig, CacheEntry, CacheManifest } from "./types";

/**
 * Public interface for cache persistence operations.
 */
type CacheStore = {
  /** Read manifest from disk, returning undefined if missing or invalid. */
  loadManifest(): CacheManifest | undefined;
  /** Return the current in-memory manifest, loading from disk on first access if not yet loaded. */
  getCurrentManifest(): CacheManifest | undefined;
  /** Persist manifest to disk using atomic write (temp file + rename). */
  saveManifest(manifest: CacheManifest): void;
  /** Retrieve a cache entry by key from the in-memory manifest. */
  getEntry(key: string): CacheEntry | undefined;
  /** Add or update a cache entry in the in-memory manifest. */
  setEntry(key: string, entry: CacheEntry): void;
  /** Remove a cache entry from the in-memory manifest. */
  deleteEntry(key: string): void;
  /** Store bundled code content directly into cache/bundles/. */
  storeBundleContent(cacheKey: string, content: string): void;
  /** Restore bundled code content from cache/bundles/. Returns undefined if not found. */
  restoreBundleContent(cacheKey: string): string | undefined;
  /** Delete the entire cache directory. */
  clean(): void;
};

const MANIFEST_FILENAME = "manifest.json";
const BUNDLES_DIR = "bundles";

/**
 * Create a cache store for manifest persistence and bundle output storage.
 * @param config - Cache configuration specifying the cache directory
 * @returns A CacheStore instance
 */
function createCacheStore(config: CacheConfig): CacheStore {
  // Tri-state: null = not yet loaded, undefined = loaded but missing/invalid, CacheManifest = loaded
  let cachedManifest: CacheManifest | undefined | null = null;

  function manifestPath(): string {
    return path.join(config.cacheDir, MANIFEST_FILENAME);
  }

  function bundlesDir(): string {
    return path.join(config.cacheDir, BUNDLES_DIR);
  }

  function bundlePath(cacheKey: string): string {
    return path.join(bundlesDir(), `${cacheKey.replaceAll(":", "_")}.js`);
  }

  function loadManifest(): CacheManifest | undefined {
    try {
      const raw = fs.readFileSync(manifestPath(), "utf-8");
      const result = cacheManifestSchema.safeParse(JSON.parse(raw));

      if (!result.success) {
        cachedManifest = undefined;
        return undefined;
      }

      cachedManifest = result.data;
      return cachedManifest;
    } catch {
      // Missing file, parse error, etc.
      cachedManifest = undefined;
      return undefined;
    }
  }

  function getCurrentManifest(): CacheManifest | undefined {
    if (cachedManifest === null) {
      loadManifest();
    }
    return cachedManifest ?? undefined;
  }

  function ensureManifestLoaded(): CacheManifest {
    if (cachedManifest === null) {
      loadManifest();
    }
    if (cachedManifest == null) {
      cachedManifest = {
        version: 1,
        sdkVersion: "",
        entries: {},
      };
    }
    return cachedManifest;
  }

  function saveManifest(manifest: CacheManifest): void {
    fs.mkdirSync(config.cacheDir, { recursive: true });

    const target = manifestPath();
    const tmpFile = path.join(config.cacheDir, `.manifest.${process.pid}.tmp`);

    // Atomic write: write to temp file, then rename
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(manifest, null, 2), "utf-8");
      fs.renameSync(tmpFile, target);
    } catch (e) {
      try {
        fs.rmSync(tmpFile, { force: true });
      } catch {
        // Ignore cleanup errors
      }
      throw e;
    }

    cachedManifest = manifest;
  }

  function getEntry(key: string): CacheEntry | undefined {
    const manifest = ensureManifestLoaded();
    return manifest.entries[key];
  }

  function setEntry(key: string, entry: CacheEntry): void {
    const manifest = ensureManifestLoaded();
    manifest.entries[key] = entry;
  }

  function deleteEntry(key: string): void {
    const manifest = ensureManifestLoaded();
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Cache entry removal by dynamic key
    delete manifest.entries[key];
  }

  function storeBundleContent(cacheKey: string, content: string): void {
    const dir = bundlesDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(bundlePath(cacheKey), content, "utf-8");
  }

  function restoreBundleContent(cacheKey: string): string | undefined {
    try {
      return fs.readFileSync(bundlePath(cacheKey), "utf-8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  }

  function clean(): void {
    fs.rmSync(config.cacheDir, { recursive: true, force: true });
    cachedManifest = null;
  }

  return {
    loadManifest,
    getCurrentManifest,
    saveManifest,
    getEntry,
    setEntry,
    deleteEntry,
    storeBundleContent,
    restoreBundleContent,
    clean,
  };
}

export { createCacheStore };
export type { CacheStore };
