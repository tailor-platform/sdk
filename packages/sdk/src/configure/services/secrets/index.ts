import type { SecretsDefinitionBrand } from "#/configure/services/secrets/types";
export type { SecretsConfig } from "#/configure/services/secrets/types";

type SecretsVaultInput = Record<string, string>;
type SecretsVaultInputNullish = Record<string, string | undefined | null>;
type SecretsInput = Record<string, SecretsVaultInput>;
type SecretsInputNullish = Record<string, SecretsVaultInputNullish>;

type SecretsOptions = {
  readonly ignoreNullishValues: boolean;
};

type DefinedSecrets<T extends SecretsInputNullish> = {
  readonly vaults: T;
  readonly options: SecretsOptions;
  /**
   * Retrieve a single secret value.
   * @deprecated since NEXT_RELEASE — import `secretmanager` from `@tailor-platform/sdk/runtime` and call `secretmanager.getSecret()` instead. Importing this object into a resolver, executor, or workflow file bundles the raw values passed to `defineSecretManager()` into that function's deployed code, which fails to build once any value comes from `process.env`. codemod: v3/secrets-get-to-secretmanager
   * @param vault - Vault name
   * @param secret - Secret name
   * @returns The secret value, or undefined if not present
   */
  get<V extends Extract<keyof T, string>, S extends Extract<keyof T[V], string>>(
    vault: V,
    secret: S,
  ): Promise<string | undefined>;
  /**
   * Retrieve multiple secret values from the same vault.
   * @deprecated since NEXT_RELEASE — import `secretmanager` from `@tailor-platform/sdk/runtime` and call `secretmanager.getSecrets()` instead (it returns a partial record keyed by name, not an array in call order). Importing this object into a resolver, executor, or workflow file bundles the raw values passed to `defineSecretManager()` into that function's deployed code, which fails to build once any value comes from `process.env`. codemod: v3/secrets-get-to-secretmanager
   * @param vault - Vault name
   * @param secrets - Secret names to fetch
   * @returns Values in the same order as `secrets`; `undefined` for any not present
   */
  getAll<V extends Extract<keyof T, string>, S extends Extract<keyof T[V], string>>(
    vault: V,
    secrets: readonly S[],
  ): Promise<(string | undefined)[]>;
} & SecretsDefinitionBrand;

/**
 * Define secrets configuration for the Tailor SDK.
 * Each key is a vault name, and its value is a record of secret name to secret value.
 * @param config - Secrets configuration mapping vault names to their secrets
 * @returns Defined secrets with typed runtime access methods
 */
export function defineSecretManager<const T extends SecretsInput>(config: T): DefinedSecrets<T>;
/**
 * Define secrets configuration for the Tailor SDK with ignoreNullishValues option.
 * When `ignoreNullishValues` is true, secrets with nullish values are skipped during deploy
 * instead of causing an error. This is useful for CI environments where not all
 * secret values are available.
 * @param config - Secrets configuration mapping vault names to their secrets
 * @param options - Options for secret management behavior
 * @param options.ignoreNullishValues - When true, secrets with nullish values are skipped during deploy
 * @returns Defined secrets with typed runtime access methods
 */
export function defineSecretManager<const T extends SecretsInputNullish>(
  config: T,
  options: { ignoreNullishValues: true },
): DefinedSecrets<T>;
/* @__NO_SIDE_EFFECTS__ */
export function defineSecretManager<const T extends SecretsInputNullish>(
  config: T,
  options?: { ignoreNullishValues?: boolean },
): DefinedSecrets<T> {
  const result: Record<string, unknown> = {
    vaults: config,
    options: { ignoreNullishValues: options?.ignoreNullishValues ?? false },
  };

  // Non-enumerable so Zod's z.object validation ignores them
  Object.defineProperty(result, "get", {
    value: async (vault: string, secret: string) => {
      return tailor.secretmanager.getSecret(vault, secret);
    },
    enumerable: false,
  });
  Object.defineProperty(result, "getAll", {
    value: async (vault: string, secrets: readonly string[]) => {
      const record = await tailor.secretmanager.getSecrets(vault, secrets);
      return secrets.map((s) => record[s]);
    },
    enumerable: false,
  });

  return result as DefinedSecrets<T>;
}
