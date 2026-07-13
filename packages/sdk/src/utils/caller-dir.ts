import { fileURLToPath } from "node:url";
import * as path from "pathe";

/**
 * Well-known symbol used to stash the directory of the module that actually
 * invoked `defineConfig()`, so relative file globs can be resolved against
 * that directory even when a different module re-exports the resulting
 * config object unchanged (e.g. a test-only config that only overrides
 * plugins/generators).
 */
export const CONFIG_SOURCE_DIR = Symbol("tailor-sdk:config-source-dir");

/**
 * Capture the absolute directory of the immediate caller of `fn`.
 * @param fn - The function whose caller's source location should be captured
 * @returns Absolute directory of the caller, or undefined if it could not be determined
 */
export function captureCallerDir(fn: (...args: never[]) => unknown): string | undefined {
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
