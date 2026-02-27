/**
 * Top-level cache state persisted to disk.
 * The version field enables schema evolution across SDK releases.
 */
export type CacheManifest = {
  /** Schema version for cache format evolution. */
  version: 1;
  /** SDK version that produced this cache; used for upgrade invalidation. */
  sdkVersion: string;
  /** Map of cache keys to their entries. */
  entries: Record<string, CacheEntry>;
};

/**
 * Per-bundle cache entry representing a single cached build output.
 */
export type CacheEntry = {
  /** Discriminant for future entry kinds. */
  kind: "bundle";
  /** Hash of the bundle input sources. */
  inputHash: string;
  /** File paths this bundle depends on, used for staleness checks. */
  dependencyPaths: string[];
  /** Output files produced by this bundle. */
  outputFiles: CacheOutputFile[];
  /** ISO 8601 timestamp of when this entry was created. */
  createdAt: string;
};

/**
 * Metadata for a single output file within a cache entry.
 */
export type CacheOutputFile = {
  /** Absolute path of the output file. */
  outputPath: string;
  /** Content hash of the output file for integrity verification. */
  contentHash: string;
};

/**
 * Runtime configuration for the caching subsystem.
 */
export type CacheConfig = {
  /** Directory where cache artifacts are stored. */
  cacheDir: string;
};
