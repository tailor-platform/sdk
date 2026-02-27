import { hashContent, hashFile, hashFiles } from "./hasher";
import type { CacheStore } from "./store";
import type { CacheEntry } from "./types";

/**
 * Parameters for attempting to restore a cached bundle output.
 */
type BundleCacheRestoreParams = {
  kind: "resolver" | "executor" | "workflow-job";
  name: string;
  outputPath: string;
  /** Optional hash of non-file context (e.g., env variables) to include in cache validation. */
  contextHash?: string;
};

/**
 * Parameters for saving a bundle output to cache.
 */
type BundleCacheSaveParams = {
  kind: "resolver" | "executor" | "workflow-job";
  name: string;
  sourceFile: string;
  outputPath: string;
  dependencyPaths: string[];
  /** Optional hash of non-file context (e.g., env variables) to include in cache key computation. */
  contextHash?: string;
};

/**
 * Cache strategy that determines whether a bundled output can be
 * restored from cache or needs rebuilding.
 */
type BundleCache = {
  /** Attempt to restore a cached bundle. Returns true if the cache was valid and output was restored. */
  tryRestore(params: BundleCacheRestoreParams): boolean;
  /** Save a bundle output and its metadata to the cache. */
  save(params: BundleCacheSaveParams): void;
};

/**
 * Build a cache key from the bundle kind and name.
 * @param kind - The bundle kind (resolver, executor, workflow-job)
 * @param name - The bundle name
 * @returns The cache key in the format `kind:name`
 */
function buildCacheKey(kind: string, name: string): string {
  return `${kind}:${name}`;
}

/**
 * Combine file dependency hash with optional context hash.
 * @param fileHash - Hash of dependency file contents
 * @param contextHash - Optional additional context hash
 * @returns Combined hash
 */
function combineHash(fileHash: string, contextHash?: string): string {
  if (!contextHash) return fileHash;
  return hashContent(fileHash + contextHash);
}

/**
 * Create a bundle cache backed by the given store.
 * @param store - The cache store for persistence
 * @param _sdkVersion - Current SDK version for cache metadata (reserved for future use)
 * @returns A BundleCache instance
 */
function createBundleCache(store: CacheStore, _sdkVersion: string): BundleCache {
  function tryRestore(params: BundleCacheRestoreParams): boolean {
    const cacheKey = buildCacheKey(params.kind, params.name);
    const entry = store.getEntry(cacheKey);

    if (!entry) {
      return false;
    }

    // Recompute hash of all stored dependency paths.
    // If any file is missing or unreadable, treat as cache miss.
    let currentHash: string;
    try {
      currentHash = combineHash(hashFiles(entry.dependencyPaths), params.contextHash);
    } catch {
      return false;
    }

    if (currentHash !== entry.inputHash) {
      return false;
    }

    // Attempt to restore the cached output file
    return store.restoreBundleOutput(cacheKey, params.outputPath);
  }

  function save(params: BundleCacheSaveParams): void {
    const cacheKey = buildCacheKey(params.kind, params.name);
    const inputHash = combineHash(hashFiles(params.dependencyPaths), params.contextHash);
    // Stored for future integrity verification (detect corrupted cache files)
    const contentHash = hashFile(params.outputPath);

    store.storeBundleOutput(cacheKey, params.outputPath);

    const entry: CacheEntry = {
      kind: "bundle",
      inputHash,
      dependencyPaths: params.dependencyPaths,
      outputFiles: [
        {
          outputPath: params.outputPath,
          contentHash,
        },
      ],
      createdAt: new Date().toISOString(),
    };

    store.setEntry(cacheKey, entry);
  }

  return { tryRestore, save };
}

export { createBundleCache };
export type { BundleCache, BundleCacheRestoreParams, BundleCacheSaveParams };
