import * as path from "pathe";
import { logger, styles } from "#/cli/shared/logger";
import { createDepCollectorPlugin } from "./dep-collector-plugin";
import { hashContent, hashFile, hashFiles } from "./hasher";
import type { CacheStore } from "./store";
import type { Plugin } from "rolldown";

type BundleKind =
  | "resolver"
  | "executor"
  | "workflow-job"
  | "auth-hook"
  | "http-adapter-input"
  | "http-adapter-output";

type BundleCacheRestoreParams = {
  kind: BundleKind;
  namespace?: string;
  name: string;
  /** Optional hash of non-file context (e.g., env variables) to include in cache validation. */
  contextHash?: string;
};

type BundleCacheSaveParams = {
  kind: BundleKind;
  namespace?: string;
  name: string;
  sourceFile: string;
  content: string;
  dependencyPaths: string[];
  /** Optional hash of non-file context (e.g., env variables) to include in cache key computation. */
  contextHash?: string;
};

/**
 * Cache strategy that determines whether a bundled output can be
 * restored from cache or needs rebuilding.
 */
type BundleCache = {
  /** Attempt to restore cached bundle content. Returns the code string if cache is valid, undefined otherwise. */
  tryRestore(params: BundleCacheRestoreParams): string | undefined;
  /** Save bundle content and its metadata to the cache. */
  save(params: BundleCacheSaveParams): void;
};

function buildCacheKey(kind: string, name: string, namespace?: string): string {
  return namespace ? `${kind}:${namespace}:${name}` : `${kind}:${name}`;
}

function combineHash(fileHash: string, contextHash?: string): string {
  if (!contextHash) return fileHash;
  return hashContent(fileHash + contextHash);
}

type ComputeBundlerContextHashParams = {
  sourceFile: string;
  serializedTriggerContext: string;
  tsconfig?: string;
  inlineSourcemap?: boolean;
  bundleLogLevel?: string;
  prefix?: string;
};

/**
 * Compute a context hash for cache invalidation across bundlers.
 *
 * Combines the source file path, serialized trigger context, tsconfig hash,
 * sourcemap mode, bundle log level, and an optional prefix (e.g., serialized
 * env variables) into a single SHA-256 hash.
 * @param params - Context hash computation parameters
 * @returns SHA-256 hex digest of the combined context
 */
function computeBundlerContextHash(params: ComputeBundlerContextHashParams): string {
  const {
    sourceFile,
    serializedTriggerContext,
    tsconfig,
    inlineSourcemap,
    bundleLogLevel,
    prefix,
  } = params;
  return hashContent(
    (prefix ?? "") +
      path.resolve(sourceFile) +
      serializedTriggerContext +
      (tsconfig ? hashFile(tsconfig) : "") +
      String(inlineSourcemap ?? false) +
      (bundleLogLevel ?? ""),
  );
}

type WithCacheParams = {
  cache: BundleCache | undefined;
  kind: BundleKind;
  namespace?: string;
  name: string;
  sourceFile: string;
  contextHash: string | undefined;
  build: (plugins: Plugin[]) => Promise<string>;
};

/**
 * Run a build with optional cache restore/save around it.
 * When caching is active, attempts to restore from cache first,
 * and saves the build result (with collected dependencies) on a cache miss.
 * @param params - Cache and build parameters
 * @returns The bundled code string
 */
async function withCache(params: WithCacheParams): Promise<string> {
  const { cache, kind, namespace, name, sourceFile, contextHash, build } = params;

  if (!cache) {
    return await build([]);
  }

  const content = cache.tryRestore({ kind, namespace, name, contextHash });
  if (content !== undefined) {
    logger.debug(`  ${styles.dim("cached")}: ${name}`);
    return content;
  }

  const { plugin, getResult } = createDepCollectorPlugin();
  const code = await build([plugin]);

  cache.save({
    kind,
    namespace,
    name,
    sourceFile,
    content: code,
    dependencyPaths: getResult(),
    contextHash,
  });

  return code;
}

/**
 * Create a bundle cache backed by the given store.
 * @param store - The cache store for persistence
 * @returns A BundleCache instance
 */
function createBundleCache(store: CacheStore): BundleCache {
  function tryRestore(params: BundleCacheRestoreParams): string | undefined {
    const cacheKey = buildCacheKey(params.kind, params.name, params.namespace);
    const entry = store.getEntry(cacheKey);

    if (!entry) {
      return undefined;
    }

    // Recompute hash of all stored dependency paths.
    // If any file is missing or unreadable, treat as cache miss.
    let currentHash: string;
    try {
      currentHash = combineHash(hashFiles(entry.dependencyPaths), params.contextHash);
    } catch {
      return undefined;
    }

    if (currentHash !== entry.inputHash) {
      return undefined;
    }

    return store.restoreBundleContent(cacheKey);
  }

  function save(params: BundleCacheSaveParams): void {
    const { kind, namespace, name, sourceFile, content, dependencyPaths, contextHash } = params;
    const cacheKey = buildCacheKey(kind, name, namespace);
    // Always include sourceFile in dependency paths so that changes to the
    // source file itself are detected even when dep-collector only finds
    // node_modules imports (which are filtered out).
    const allDeps = dependencyPaths.includes(sourceFile)
      ? dependencyPaths
      : [sourceFile, ...dependencyPaths];
    const inputHash = combineHash(hashFiles(allDeps), contextHash);
    const contentHash = hashContent(content);

    store.storeBundleContent(cacheKey, content);

    store.setEntry(cacheKey, {
      kind: "bundle",
      inputHash,
      dependencyPaths: allDeps,
      outputFiles: [{ outputPath: cacheKey, contentHash }],
      createdAt: new Date().toISOString(),
    });
  }

  return { tryRestore, save };
}

export { computeBundlerContextHash, createBundleCache, withCache };
export type { BundleCache, BundleCacheRestoreParams, BundleCacheSaveParams };
