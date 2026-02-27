import * as fs from "node:fs";
import * as path from "pathe";
import { enableInlineSourcemap } from "@/cli/bundler/inline-sourcemap";
import { logger, styles } from "@/cli/utils/logger";
import { createDepCollectorPlugin } from "./dep-collector-plugin";
import { hashContent, hashFile, hashFiles } from "./hasher";
import type { CacheStore } from "./store";
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
  const { sourceFile, serializedTriggerContext, tsconfig, prefix } = params;
  return hashContent(
    (prefix ?? "") +
      path.resolve(sourceFile) +
      serializedTriggerContext +
      (tsconfig ? hashFile(tsconfig) : "") +
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
  const { cache, kind, name, sourceFile, outputPath, contextHash, build } = params;

  if (!cache) {
    await build([]);
    return;
  }

  const restored = cache.tryRestore({ kind, name, outputPath, contextHash });
  if (restored) {
    logger.debug(`  ${styles.dim("cached")}: ${name}`);
    return;
  }

  const { plugin, getResult } = createDepCollectorPlugin();
  await build([plugin]);

  cache.save({ kind, name, sourceFile, outputPath, dependencyPaths: getResult(), contextHash });
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
    const { kind, name, sourceFile, outputPath, dependencyPaths, contextHash } = params;
    const cacheKey = buildCacheKey(kind, name);
    // Always include sourceFile in dependency paths so that changes to the
    // source file itself are detected even when dep-collector only finds
    // node_modules imports (which are filtered out).
    const allDeps = dependencyPaths.includes(sourceFile)
      ? dependencyPaths
      : [sourceFile, ...dependencyPaths];
    const inputHash = combineHash(hashFiles(allDeps), contextHash);
    // Stored for future integrity verification (detect corrupted cache files)
    const contentHash = hashFile(outputPath);

    store.storeBundleOutput(cacheKey, outputPath);

    const outputFiles = [{ outputPath, contentHash }];
    const mapPath = `${outputPath}.map`;
    if (fs.existsSync(mapPath)) {
      outputFiles.push({ outputPath: mapPath, contentHash: hashFile(mapPath) });
    }

    store.setEntry(cacheKey, {
      kind: "bundle",
      inputHash,
      dependencyPaths: allDeps,
      outputFiles,
      createdAt: new Date().toISOString(),
    });
  }

  return { tryRestore, save };
}

export { computeBundlerContextHash, createBundleCache, withCache };
export type { BundleCache, BundleCacheRestoreParams, BundleCacheSaveParams };
