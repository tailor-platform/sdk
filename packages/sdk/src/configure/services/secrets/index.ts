declare const secretsDefinitionBrand: unique symbol;
type SecretsDefinitionBrand = { readonly [secretsDefinitionBrand]: true };

type SecretsVaultInput = Record<string, string | undefined>;
type SecretsInput = Record<string, SecretsVaultInput>;

type DefinedSecrets<T extends SecretsInput> = {
  readonly [K in keyof T]: { readonly [S in keyof T[K]]: T[K][S] };
} & {
  get<V extends Extract<keyof T, string>, S extends Extract<keyof T[V], string>>(
    vault: V,
    secret: S,
  ): Promise<string | undefined>;
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
export function defineSecrets<const T extends SecretsInput>(config: T): DefinedSecrets<T> {
  const result = {
    ...config,
    async get(vault: string, secret: string): Promise<string | undefined> {
      return tailor.secretmanager.getSecret(vault, secret);
    },
    async getAll(vault: string, secrets: readonly string[]): Promise<(string | undefined)[]> {
      const record = await tailor.secretmanager.getSecrets(vault, secrets);
      return secrets.map((s) => record[s]);
    },
  };

  return result as unknown as DefinedSecrets<T>;
}
