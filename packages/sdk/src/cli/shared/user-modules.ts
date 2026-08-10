import { pathToFileURL } from "node:url";

export const IMPORT_NONCE_PARAM = "tailorImportNonce";

let runCounter = 0;

/**
 * Start a fresh user-module run. Modules imported through
 * {@link importUserModule} after this call bypass the ESM cache entries of
 * earlier runs, so a repeated in-process run re-evaluates user code instead
 * of reusing stale modules.
 */
export function beginUserModuleRun(): void {
  runCounter += 1;
}

/**
 * Read the cache-busting nonce of the current user-module run.
 * @returns The nonce, or undefined when no run was started
 */
export function currentImportNonce(): string | undefined {
  return runCounter === 0 ? undefined : String(runCounter);
}

/**
 * Import a user module (config, workflow, resolver, executor, ...) with the
 * current run's cache-busting nonce applied. Outside a run this is a plain
 * import.
 * @param filePath - Absolute path of the user module
 * @returns The imported module namespace
 */
export function importUserModule(filePath: string): Promise<Record<string, unknown>> {
  const url = pathToFileURL(filePath);
  const nonce = currentImportNonce();
  if (nonce) {
    url.searchParams.set(IMPORT_NONCE_PARAM, nonce);
  }
  return import(url.href);
}
