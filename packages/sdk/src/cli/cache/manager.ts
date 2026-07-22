import * as path from "pathe";
import { getDistDir } from "#/cli/shared/dist-dir";
import { logger } from "#/cli/shared/logger";
import { createBundleCache, type BundleCache } from "./bundle-cache";
import { createCacheStore } from "./store";

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
  /** Hash of the lockfile for cache invalidation on dependency changes. */
  lockfileHash?: string;
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
 * Create a CacheManager that orchestrates cache operations.
 * @param options - Configuration for the cache manager
 * @returns A CacheManager instance
 */
function createCacheManager(options: CacheManagerOptions): CacheManager {
  const enabled = options.enabled ?? true;

  if (!enabled) {
    return {
      enabled: false,
      bundleCache: {
        tryRestore() {
          return undefined;
        },
        save() {
          // no-op
        },
      },
      finalize() {
        // no-op
      },
    };
  }

  const cacheDir = options.cacheDir ?? path.resolve(getDistDir(), "cache");

  const store = createCacheStore({ cacheDir });

  // Load existing manifest and check SDK version / lockfile hash for cache invalidation
  const existingManifest = store.loadManifest();
  if (existingManifest) {
    if (existingManifest.sdkVersion !== options.sdkVersion) {
      logger.debug(
        `Cache invalidated: SDK version changed from ${existingManifest.sdkVersion} to ${options.sdkVersion}`,
      );
      store.clean();
    } else if (existingManifest.lockfileHash !== options.lockfileHash) {
      logger.debug("Cache invalidated: lockfile changed");
      store.clean();
    }
  }

  const bundleCache = createBundleCache(store);

  return {
    enabled: true,
    bundleCache,
    finalize() {
      const currentManifest = store.getCurrentManifest() ?? {
        version: 1 as const,
        sdkVersion: options.sdkVersion,
        lockfileHash: options.lockfileHash,
        entries: {},
      };
      const latestManifest = store.loadManifest();
      const manifest =
        latestManifest?.sdkVersion === options.sdkVersion &&
        latestManifest.lockfileHash === options.lockfileHash
          ? {
              ...latestManifest,
              entries: {
                ...latestManifest.entries,
                ...currentManifest.entries,
              },
            }
          : currentManifest;
      manifest.sdkVersion = options.sdkVersion;
      manifest.lockfileHash = options.lockfileHash;
      store.saveManifest(manifest);
    },
  };
}

export { createCacheManager };
export type { CacheManager, CacheManagerOptions };
