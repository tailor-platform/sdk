import * as path from "pathe";
import { enableInlineSourcemap } from "@/cli/bundler/inline-sourcemap";
import { createDepCollectorPlugin } from "./dep-collector-plugin";
import { hashContent, hashFile, hashFiles } from "./hasher";
import type { CacheStore } from "./store";
import type { CacheEntry } from "./types";
import type { Plugin } from "rolldown";

type BundleKind = "resolver" | "executor" | "workflow-job";

/**
 * Parameters for attempting to restore a cached bundle output.
 */
type BundleCacheRestoreParams = {
  kind: BundleKind;
  name: string;
  outputPath: string;
  /** Optional hash of non-file context (e.g., env variables) to include in cache validation. */
  contextHash?: string;
};

/**
 * Parameters for saving a bundle output to cache.
 */
type BundleCacheSaveParams = {
  kind: BundleKind;
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
 * Compute a context hash for cache invalidation across bundlers.
 *
 * Combines the source file path, serialized trigger context, tsconfig hash,
 * sourcemap mode, and an optional prefix (e.g., serialized env variables)
 * into a single SHA-256 hash.
 * @param params - Context hash computation parameters
 * @param params.sourceFile
 * @param params.serializedTriggerContext
 * @param params.tsconfig
 * @param params.prefix
 * @returns SHA-256 hex digest of the combined context
 */
function computeBundlerContextHash(params: {
  sourceFile: string;
  serializedTriggerContext: string;
  tsconfig?: string;
  prefix?: string;
}): string {
  return hashContent(
    (params.prefix ?? "") +
      path.resolve(params.sourceFile) +
      params.serializedTriggerContext +
      (params.tsconfig ? hashFile(params.tsconfig) : "") +
      String(enableInlineSourcemap),
  );
}

/**
 * Result of setting up a dep-collector plugin for cache tracking.
 */
type DepCollectorSetup = {
  getDependencyPaths: () => string[];
};

/**
 * Create and append a dep-collector plugin to the given plugin array when caching is active.
 * @param cache - Bundle cache instance (undefined when caching is disabled)
 * @param plugins - Rolldown plugin array to append to
 * @returns Setup result for retrieving collected paths, or undefined when caching is disabled
 */
function setupDepCollector(
  cache: BundleCache | undefined,
  plugins: Plugin[],
): DepCollectorSetup | undefined {
  if (!cache) return undefined;
  const { plugin, getResult } = createDepCollectorPlugin();
  plugins.push(plugin);
  return { getDependencyPaths: getResult };
}

/**
 * Save a bundle build result to cache if caching is active.
 * @param params - Save parameters including cache, depCollector, and bundle metadata
 * @param params.cache
 * @param params.depCollector
 * @param params.kind
 * @param params.name
 * @param params.sourceFile
 * @param params.outputPath
 * @param params.contextHash
 */
function saveBundleToCache(params: {
  cache?: BundleCache;
  depCollector?: DepCollectorSetup;
  kind: BundleKind;
  name: string;
  sourceFile: string;
  outputPath: string;
  contextHash?: string;
}): void {
  const { cache, depCollector, ...rest } = params;
  if (!cache || !depCollector) return;
  cache.save({
    ...rest,
    dependencyPaths: depCollector.getDependencyPaths(),
  });
}

/**
 * Create a bundle cache backed by the given store.
 * @param store - The cache store for persistence
 * @returns A BundleCache instance
 */
function createBundleCache(store: CacheStore): BundleCache {
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

export { computeBundlerContextHash, createBundleCache, saveBundleToCache, setupDepCollector };
export type { BundleCache, BundleCacheRestoreParams, BundleCacheSaveParams };
