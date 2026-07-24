import { resolveTSConfig } from "pkg-types";
import { logger } from "#/cli/shared/logger";

// resolveTSConfigWithFallback is called once per bundler/service, so a
// single generate/apply run can call it multiple times for the same baseDir
// (once per resolver/executor/tailordb/etc. config sharing that directory).
// Track which baseDirs have already warned so each one only warns once per run.
const warnedBaseDirs = new Set<string>();

/**
 * Resolve the nearest tsconfig.json for baseDir, falling back to the tsconfig
 * resolved from the invocation cwd when baseDir's own ancestry has none.
 * @param baseDir - Directory to resolve the tsconfig against
 * @returns Absolute path to the resolved tsconfig.json, or undefined if none was found
 */
export async function resolveTSConfigWithFallback(baseDir: string): Promise<string | undefined> {
  const tsconfig = await tryResolve(baseDir);
  if (tsconfig || baseDir === process.cwd()) {
    return tsconfig;
  }

  // v1 compatibility fallback: pre-existing configs may rely on a tsconfig
  // discoverable from the invocation cwd rather than baseDir. Remove this
  // fallback in v2, once such configs are expected to have migrated.
  const fallback = await tryResolve(process.cwd());
  if (fallback && !warnedBaseDirs.has(baseDir)) {
    warnedBaseDirs.add(baseDir);
    logger.warn(
      `No tsconfig found from "${baseDir}"; falling back to the tsconfig resolved from ` +
        `process.cwd(). Move (or extend) a tsconfig into this directory before ` +
        `v2, when this fallback will be removed.`,
    );
  }
  return fallback;
}

async function tryResolve(dir: string): Promise<string | undefined> {
  try {
    return await resolveTSConfig(dir);
  } catch {
    return undefined;
  }
}
