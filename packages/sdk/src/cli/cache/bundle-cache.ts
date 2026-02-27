import * as path from "pathe";
import { enableInlineSourcemap } from "@/cli/bundler/inline-sourcemap";
import { logger, styles } from "@/cli/utils/logger";
import { createDepCollectorPlugin } from "./dep-collector-plugin";
import { hashContent, hashFile, hashFiles } from "./hasher";
import type { CacheStore } from "./store";
import type { CacheEntry } from "./types";
import type { Plugin } from "rolldown";

type BundleKind = "resolver" | "executor" | "workflow-job";

type BundleCacheRestoreParams = {
  kind: BundleKind;
  name: string;
  outputPath: string;
  /** Optional hash of non-file context (e.g., env variables) to include in cache validation. */
  contextHash?: string;
};

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

function buildCacheKey(kind: string, name: string): string {
  return `${kind}:${name}`;
}

function combineHash(fileHash: string, contextHash?: string): string {
  if (!contextHash) return fileHash;
  return hashContent(fileHash + contextHash);
}

type ComputeBundlerContextHashParams = {
  sourceFile: string;
  serializedTriggerContext: string;
  tsconfig?: string;
  prefix?: string;
};

/**
 * Compute a context hash for cache invalidation across bundlers.
 *
 * Combines the source file path, serialized trigger context, tsconfig hash,
 * sourcemap mode, and an optional prefix (e.g., serialized env variables)
 * into a single SHA-256 hash.
 * @param params - Context hash computation parameters
 * @returns SHA-256 hex digest of the combined context
 */
function computeBundlerContextHash(params: ComputeBundlerContextHashParams): string {
  return hashContent(
    (params.prefix ?? "") +
      path.resolve(params.sourceFile) +
      params.serializedTriggerContext +
      (params.tsconfig ? hashFile(params.tsconfig) : "") +
      String(enableInlineSourcemap),
  );
}

type WithCacheParams = {
  cache: BundleCache | undefined;
  kind: BundleKind;
  name: string;
  sourceFile: string;
  outputPath: string;
  contextHash: string | undefined;
  build: (plugins: Plugin[]) => Promise<void>;
};

/**
 * Run a build with optional cache restore/save around it.
 * When caching is active, attempts to restore from cache first,
 * and saves the build result (with collected dependencies) on a cache miss.
 * @param params - Cache and build parameters
 */
async function withCache(params: WithCacheParams): Promise<void> {
  if (!params.cache) {
    await params.build([]);
    return;
  }

  const restored = params.cache.tryRestore({
    kind: params.kind,
    name: params.name,
    outputPath: params.outputPath,
    contextHash: params.contextHash,
  });
  if (restored) {
    logger.debug(`  ${styles.dim("cached")}: ${params.name}`);
    return;
  }

  const { plugin, getResult } = createDepCollectorPlugin();
  await params.build([plugin]);

  params.cache.save({
    kind: params.kind,
    name: params.name,
    sourceFile: params.sourceFile,
    outputPath: params.outputPath,
    dependencyPaths: getResult(),
    contextHash: params.contextHash,
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
    // Always include sourceFile in dependency paths so that changes to the
    // source file itself are detected even when dep-collector only finds
    // node_modules imports (which are filtered out).
    const allDeps = params.dependencyPaths.includes(params.sourceFile)
      ? params.dependencyPaths
      : [params.sourceFile, ...params.dependencyPaths];
    const inputHash = combineHash(hashFiles(allDeps), params.contextHash);
    // Stored for future integrity verification (detect corrupted cache files)
    const contentHash = hashFile(params.outputPath);

    store.storeBundleOutput(cacheKey, params.outputPath);

    const entry: CacheEntry = {
      kind: "bundle",
      inputHash,
      dependencyPaths: allDeps,
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

export { computeBundlerContextHash, createBundleCache, withCache };
export type { BundleCache, BundleCacheRestoreParams, BundleCacheSaveParams };
