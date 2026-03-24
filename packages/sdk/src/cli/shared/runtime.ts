/**
 * Check if the current runtime natively supports TypeScript execution.
 * Bun and Deno can execute TypeScript without tsx or other loaders.
 *
 * Note: Deno is detected here for correct loader/transport selection, but
 * the CLI is not fully tested on Deno yet. Other dependencies may fail.
 * @returns true if running on Bun or Deno
 */
export function isNativeTypeScriptRuntime(): boolean {
  return isBun() || isDeno();
}

/**
 * Check if the current runtime is Bun.
 * @returns true if running on Bun
 */
export function isBun(): boolean {
  return "Bun" in globalThis;
}

/**
 * Check if the current runtime is Deno.
 * @returns true if running on Deno
 */
export function isDeno(): boolean {
  return "Deno" in globalThis;
}
