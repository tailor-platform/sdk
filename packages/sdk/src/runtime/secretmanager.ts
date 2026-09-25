/**
 * Secret manager utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.secretmanager` runtime API.
 * At runtime this delegates to `globalThis.tailor.secretmanager`. Use
 * `mockSecretmanager` from `@tailor-platform/sdk/vitest` to mock these calls
 * in unit tests.
 *
 * `vault` is narrowed to the vault names declared via `defineSecretManager()` once
 * `tailor.d.ts` has been generated (via `tailor deploy`/`generate`), and `name`/`names`
 * are further narrowed to that vault's declared secret names.
 * @example
 * import { secretmanager } from "@tailor-platform/sdk/runtime";
 *
 * const apiKey = await secretmanager.getSecret("my-vault", "API_KEY");
 * const all = await secretmanager.getSecrets("my-vault", ["A", "B"]);
 */

// Import from the public entry (not `#/configure/types/secret-vault-name`) so this d.ts
// references `@tailor-platform/sdk` externally instead of inlining the registry — the
// same generated `declare module "@tailor-platform/sdk"` that narrows
// `aigateway.get`/`authconnection.getConnectionToken` then also narrows this entry.
import type { SecretNameFor, SecretVaultName } from "@tailor-platform/sdk";

/**
 * Platform API surface for `tailor.secretmanager`. Describes the shape the
 * platform runtime injects on `globalThis.tailor.secretmanager`.
 */
export interface TailorSecretmanagerAPI {
  /**
   * Returns multiple secrets from a vault. Missing names are omitted from the result.
   * @param vault - Vault name, as passed to `defineSecretManager()`
   * @param names - Secret names to fetch
   * @returns Partial record keyed by the requested names
   */
  getSecrets<const V extends SecretVaultName, const T extends readonly SecretNameFor<V>[]>(
    vault: V,
    names: T,
  ): Promise<Partial<Record<T[number], string>>>;

  /**
   * Returns a single secret from a vault, or `undefined` when missing.
   * @param vault - Vault name, as passed to `defineSecretManager()`
   * @param name - Secret name
   * @returns The secret value, or `undefined` if not present
   */
  getSecret<V extends SecretVaultName>(
    vault: V,
    name: SecretNameFor<V>,
  ): Promise<string | undefined>;
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
