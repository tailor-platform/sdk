declare const secretsDefinitionBrand: unique symbol;
type SecretsDefinitionBrand = { readonly [secretsDefinitionBrand]: true };

type SecretsVaultInput = Record<string, string>;
type SecretsVaultInputNullish = Record<string, string | undefined | null>;
type SecretsInput = Record<string, SecretsVaultInput>;
type SecretsInputNullish = Record<string, SecretsVaultInputNullish>;

type SecretsOptions = {
  readonly skipNullishValues: boolean;
};

type DefinedSecrets<T extends SecretsInputNullish> = {
  readonly vaults: T;
  readonly options: SecretsOptions;
  get<V extends Extract<keyof T, string>, S extends Extract<keyof T[V], string>>(
    vault: V,
    secret: S,
  ): Promise<string | undefined>;
  getAll<V extends Extract<keyof T, string>, S extends Extract<keyof T[V], string>>(
    vault: V,
    secrets: readonly S[],
  ): Promise<(string | undefined)[]>;
} & SecretsDefinitionBrand;

/** Type accepted by `AppConfig.secrets`. Only values returned by `defineSecretManager()` satisfy this. */
export type SecretsConfig = Omit<ReturnType<typeof defineSecretManager>, "get" | "getAll">;

/**
 * Define secrets configuration for the Tailor SDK.
 * Each key is a vault name, and its value is a record of secret name to secret value.
 * @param config - Secrets configuration mapping vault names to their secrets
 * @returns Defined secrets with typed runtime access methods
 */
export function defineSecretManager<const T extends SecretsInput>(config: T): DefinedSecrets<T>;
/**
 * Define secrets configuration for the Tailor SDK with skipNullishValues option.
 * When `skipNullishValues` is true, secrets with nullish values are skipped during deploy
 * instead of causing an error. This is useful for CI environments where not all
 * secret values are available.
 * @param config - Secrets configuration mapping vault names to their secrets
 * @param options - Options for secret management behavior
 * @param options.skipNullishValues - When true, secrets with nullish values are skipped during deploy
 * @returns Defined secrets with typed runtime access methods
 */
export function defineSecretManager<const T extends SecretsInputNullish>(
  config: T,
  options: { skipNullishValues: true },
): DefinedSecrets<T>;
export function defineSecretManager<const T extends SecretsInputNullish>(
  config: T,
  options?: { skipNullishValues?: boolean },
): DefinedSecrets<T> {
  const result: Record<string, unknown> = {
    vaults: config,
    options: { skipNullishValues: options?.skipNullishValues ?? false },
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
