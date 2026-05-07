/**
 * Secret manager utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.secretmanager` runtime API.
 * At runtime this delegates to `globalThis.tailor.secretmanager`. Use
 * `secretmanagerMock` from `@tailor-platform/sdk/vitest` to mock these calls
 * in unit tests.
 * @example
 * import { secretmanager } from "@tailor-platform/sdk/runtime";
 *
 * const apiKey = await secretmanager.getSecret("my-vault", "API_KEY");
 * const all = await secretmanager.getSecrets("my-vault", ["A", "B"] as const);
 */

import "./globals";

/**
 * Returns multiple secrets from a vault. Missing names are omitted from the result.
 * @param vault - Vault name
 * @param names - Secret names to fetch (use `as const` to narrow the result key)
 * @returns Partial record keyed by the requested names
 */
export function getSecrets<const T extends readonly string[]>(
  vault: string,
  names: T,
): Promise<Partial<Record<T[number], string>>> {
  return tailor.secretmanager.getSecrets(vault, names);
}

/**
 * Returns a single secret from a vault, or `undefined` when missing.
 * @param vault - Vault name
 * @param name - Secret name
 * @returns The secret value, or `undefined` if not present
 */
export function getSecret(vault: string, name: string): Promise<string | undefined> {
  return tailor.secretmanager.getSecret(vault, name);
}
