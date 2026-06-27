import { z } from "zod";

const cacheOutputFileSchema = /* strip unknown keys */ z.object({
  outputPath: z.string(),
  contentHash: z.string(),
});

const cacheEntrySchema = /* strip unknown keys */ z.object({
  kind: z.literal("bundle"),
  inputHash: z.string(),
  dependencyPaths: z.array(z.string()),
  outputFiles: z.array(cacheOutputFileSchema),
  createdAt: z.string(),
});

const cacheManifestSchema = /* strip unknown keys */ z.object({
  version: z.literal(1),
  sdkVersion: z.string(),
  lockfileHash: z.string().optional(),
  entries: z.record(z.string(), cacheEntrySchema),
});

type CacheEntry = z.infer<typeof cacheEntrySchema>;
type CacheManifest = z.infer<typeof cacheManifestSchema>;

/**
 * Runtime configuration for the caching subsystem.
 */
type CacheConfig = {
  /** Directory where cache artifacts are stored. */
  cacheDir: string;
};

export { cacheManifestSchema };
export type { CacheConfig, CacheEntry, CacheManifest };
