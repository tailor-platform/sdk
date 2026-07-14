import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolveTSConfigWithFallback } from "#/cli/shared/resolve-tsconfig";

// Node's own module-resolution error codes (both ESM and CJS). tsx's tsconfig
// `paths` resolver is scoped to the resolved tsconfig's directory tree, but a
// `paths` entry can redirect into a location that itself relies on resolution
// tsx doesn't fully replicate (e.g. a package.json `imports` subpath). Retrying
// with a plain import degrades to this function's pre-`paths`-aware behavior
// rather than failing a load that would otherwise succeed.
const MODULE_RESOLUTION_ERROR_CODES = new Set([
  "ERR_MODULE_NOT_FOUND",
  "ERR_INVALID_MODULE_SPECIFIER",
  "ERR_PACKAGE_PATH_NOT_EXPORTED",
  "ERR_PACKAGE_IMPORT_NOT_DEFINED",
  "MODULE_NOT_FOUND",
]);

function isModuleResolutionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    MODULE_RESOLUTION_ERROR_CODES.has(error.code)
  );
}

/**
 * Import a user-authored file, honoring path aliases declared in the
 * tsconfig resolved from baseDir.
 *
 * Plain dynamic `import()` does not apply tsconfig `paths` remapping, so a
 * file importing through a path alias (e.g. `@/utils`) would otherwise fail
 * to resolve — or, if a same-named alias happens to exist in a tsconfig
 * discoverable from somewhere else in the process, resolve against the
 * wrong location. This loads through tsx's ESM loader, scoped to the
 * resolved tsconfig via its `namespace` option (so concurrent loads for
 * different apps never observe each other's tsconfig), falling back to a
 * plain dynamic import when no tsconfig is found or tsx's resolver can't
 * follow a `paths` target.
 * @param filePath - Absolute path to the file to import
 * @param baseDir - Directory the file's tsconfig is resolved against
 * @returns The imported module's namespace object
 */
export async function importUserFile(
  filePath: string,
  baseDir: string,
): Promise<Record<string, unknown>> {
  const tsconfig = await resolveTSConfigWithFallback(baseDir);
  if (!tsconfig) {
    return await import(pathToFileURL(filePath).href);
  }

  const { register } = await import("tsx/esm/api");
  // The namespace only needs to be unique per call (it scopes this
  // registration's tsconfig away from concurrent loads); it must not embed
  // filesystem path characters, which the underlying tsx:// URL can't carry.
  const scoped = register({ namespace: randomUUID(), tsconfig });
  try {
    return await scoped.import(filePath, import.meta.url);
  } catch (error) {
    if (isModuleResolutionError(error)) {
      return await import(pathToFileURL(filePath).href);
    }
    throw error;
  } finally {
    await scoped.unregister();
  }
}
