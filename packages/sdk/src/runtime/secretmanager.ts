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
  (globalThis as unknown as { tailor: { secretmanager: TailorSecretmanagerAPI } }).tailor
    .secretmanager;

const getSecrets: TailorSecretmanagerAPI["getSecrets"] = (...args) => api().getSecrets(...args);

const getSecret: TailorSecretmanagerAPI["getSecret"] = (...args) => api().getSecret(...args);

/** Runtime wrapper namespace for `tailor.secretmanager`. */
export const secretmanager = {
  getSecrets,
  getSecret,
} as const satisfies TailorSecretmanagerAPI;
