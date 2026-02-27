import * as path from "pathe";
import { getDistDir } from "@/cli/utils/dist-dir";
import { logger } from "@/cli/utils/logger";
import { createBundleCache } from "./bundle-cache";
import { createCacheStore } from "./store";
import type { BundleCache } from "./bundle-cache";

/**
 * Options for creating a CacheManager.
 */
type CacheManagerOptions = {
  /** Whether caching is enabled. Defaults to true. */
  enabled?: boolean;
  /** Directory where cache artifacts are stored. Defaults to `<distDir>/cache`. */
  cacheDir?: string;
  /** Current SDK version for cache invalidation on upgrade. */
  sdkVersion: string;
};

/**
 * Top-level facade that orchestrates cache operations.
 */
type CacheManager = {
  readonly enabled: boolean;
  readonly bundleCache: BundleCache;
  /** Persist the cache manifest to disk. */
  finalize(): void;
};

/**
 * Create a no-op BundleCache for use when caching is disabled.
 * @returns A BundleCache where tryRestore always returns false and save is a no-op
 */
function createNoopBundleCache(): BundleCache {
  return {
    tryRestore() {
      return false;
    },
    save() {
      // no-op
    },
  };
}

/**
 * Create a CacheManager that orchestrates cache operations.
 * @param options - Configuration for the cache manager
 * @returns A CacheManager instance
 */
function createCacheManager(options: CacheManagerOptions): CacheManager {
  const enabled = options.enabled ?? true;

  if (!enabled) {
    return {
      enabled: false,
      bundleCache: createNoopBundleCache(),
      finalize() {
        // no-op
      },
    };
  }

  const cacheDir = options.cacheDir ?? path.resolve(getDistDir(), "cache");

  const store = createCacheStore({ cacheDir });

  // Load existing manifest and check SDK version for cache invalidation
  const existingManifest = store.loadManifest();
  if (existingManifest && existingManifest.sdkVersion !== options.sdkVersion) {
    logger.debug(
      `Cache invalidated: SDK version changed from ${existingManifest.sdkVersion} to ${options.sdkVersion}`,
    );
    store.clean();
  }

  const bundleCache = createBundleCache(store);

  return {
    enabled: true,
    bundleCache,
    finalize() {
      // Use in-memory manifest to preserve entries added during the session
      const manifest = store.getCurrentManifest() ?? {
        version: 1 as const,
        sdkVersion: options.sdkVersion,
        entries: {},
      };
      manifest.sdkVersion = options.sdkVersion;
      store.saveManifest(manifest);
    },
  };
}

export { createCacheManager };
export type { CacheManager, CacheManagerOptions };
