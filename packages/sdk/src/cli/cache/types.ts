import * as v from "valibot";

// strip unknown keys
const cacheOutputFileSchema = v.object({
  outputPath: v.string(),
  contentHash: v.string(),
});

// strip unknown keys
const cacheEntrySchema = v.object({
  kind: v.literal("bundle"),
  inputHash: v.string(),
  dependencyPaths: v.array(v.string()),
  outputFiles: v.array(cacheOutputFileSchema),
  createdAt: v.string(),
});

// strip unknown keys
const cacheManifestSchema = v.object({
  version: v.literal(1),
  sdkVersion: v.string(),
  lockfileHash: v.optional(v.string()),
  entries: v.record(v.string(), cacheEntrySchema),
});

type CacheEntry = v.InferOutput<typeof cacheEntrySchema>;
type CacheManifest = v.InferOutput<typeof cacheManifestSchema>;

/**
 * Runtime configuration for the caching subsystem.
 */
type CacheConfig = {
  /** Directory where cache artifacts are stored. */
  cacheDir: string;
};

export { cacheManifestSchema };
export type { CacheConfig, CacheEntry, CacheManifest };
