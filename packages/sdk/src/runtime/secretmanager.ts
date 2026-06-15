/**
 * Secret manager utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.secretmanager` runtime API.
 * At runtime this delegates to `globalThis.tailor.secretmanager`. Use
 * `mockSecretmanager` from `@tailor-platform/sdk/vitest` to mock these calls
 * in unit tests.
 * @example
 * import { secretmanager } from "@tailor-platform/sdk/runtime";
 *
 * const apiKey = await secretmanager.getSecret("my-vault", "API_KEY");
 * const all = await secretmanager.getSecrets("my-vault", ["A", "B"] as const);
 */

/**
 * Platform API surface for `tailor.secretmanager`. Describes the shape the
 * platform runtime injects on `globalThis.tailor.secretmanager`.
 *
 * Each method below is also re-exported as a top-level named export from this
 * module so callers can either `import * as secretmanager from
 * "@tailor-platform/sdk/runtime/secretmanager"` or pick individual methods.
 */
export interface TailorSecretmanagerAPI {
  /**
   * Returns multiple secrets from a vault. Missing names are omitted from the result.
   * @param vault - Vault name
   * @param names - Secret names to fetch (use `as const` to narrow the result key)
   * @returns Partial record keyed by the requested names
   */
  getSecrets<const T extends readonly string[]>(
    vault: string,
    names: T,
  ): Promise<Partial<Record<T[number], string>>>;

  /**
   * Returns a single secret from a vault, or `undefined` when missing.
   * @param vault - Vault name
   * @param name - Secret name
   * @returns The secret value, or `undefined` if not present
   */
  getSecret(vault: string, name: string): Promise<string | undefined>;
}

const api = (): TailorSecretmanagerAPI =>
  (globalThis as { tailor: { secretmanager: TailorSecretmanagerAPI } }).tailor.secretmanager;

/**
 * See {@link TailorSecretmanagerAPI.getSecrets}.
 * @param args - Forwarded to {@link TailorSecretmanagerAPI.getSecrets}
 * @returns Partial record keyed by the requested names
 */
export const getSecrets: TailorSecretmanagerAPI["getSecrets"] = (...args) =>
  api().getSecrets(...args);

/**
 * See {@link TailorSecretmanagerAPI.getSecret}.
 * @param args - Forwarded to {@link TailorSecretmanagerAPI.getSecret}
 * @returns The secret value, or `undefined` if not present
 */
export const getSecret: TailorSecretmanagerAPI["getSecret"] = (...args) => api().getSecret(...args);
