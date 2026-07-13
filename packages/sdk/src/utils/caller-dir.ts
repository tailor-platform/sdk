import { fileURLToPath } from "node:url";
import * as path from "pathe";

/**
 * Well-known symbol used to stash the directory of the module that actually
 * invoked `defineConfig()`, so relative file globs can be resolved against
 * that directory even when a different module re-exports the resulting
 * config object unchanged (e.g. a test-only config that only overrides
 * plugins/generators).
 *
 * Uses the global symbol registry (`Symbol.for`) rather than `Symbol()` so
 * the key still matches if multiple copies of the SDK end up loaded in the
 * same process (e.g. a hoisting mismatch between the CLI and the config's
 * own dependency resolution). Matches the `SDK_BRAND` / registry key
 * convention in `utils/brand.ts` and `configure/services/workflow/registry.ts`.
 */
export const CONFIG_SOURCE_DIR: unique symbol = Symbol.for("tailor-platform/sdk:config-source-dir");

/**
 * Capture the absolute directory of the immediate caller of `fn`.
 * @param fn - The function whose caller's source location should be captured; never invoked, only used as the `Error.captureStackTrace` exclusion marker
 * @returns Absolute directory of the caller, or undefined if it could not be determined
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function captureCallerDir(fn: (...args: any[]) => unknown): string | undefined {
  const target: { stack?: NodeJS.CallSite[] } = {};
  const originalPrepareStackTrace = Error.prepareStackTrace;
  try {
    Error.prepareStackTrace = (_error, stack) => stack;
    Error.captureStackTrace(target, fn);
    const callerFile = target.stack?.[0]?.getFileName();
    if (!callerFile) return undefined;
    const queryIndex = callerFile.indexOf("?");
    const cleanFile = queryIndex === -1 ? callerFile : callerFile.slice(0, queryIndex);
    const filePath = cleanFile.startsWith("file://") ? fileURLToPath(cleanFile) : cleanFile;
    return path.dirname(filePath);
  } catch {
    return undefined;
  } finally {
    Error.prepareStackTrace = originalPrepareStackTrace;
  }
}

/**
 * Read the source directory previously captured via `captureCallerDir` and stashed under `CONFIG_SOURCE_DIR`.
 * @param config - A loaded config object
 * @returns The captured directory, or undefined if none was captured
 */
export function getConfigSourceDir(config: object): string | undefined {
  return (config as Record<PropertyKey, unknown>)[CONFIG_SOURCE_DIR] as string | undefined;
}

/**
 * Resolve the directory relative file globs and tsconfig lookups should use
 * for a loaded config: the captured `defineConfig()` call site when
 * available, otherwise the directory of the config file itself.
 * @param config - A loaded config object with its file path
 * @returns Absolute directory to resolve relative patterns against
 */
export function resolveConfigBaseDir(config: { path: string }): string {
  return getConfigSourceDir(config) ?? path.dirname(config.path);
}
