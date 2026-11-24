import type { SecretsInput } from "#/types/secrets.generated";

declare const secretsDefinitionBrand: unique symbol;
export type SecretsDefinitionBrand = { readonly [secretsDefinitionBrand]: true };

/** Type accepted by `AppConfig.secrets`. Only values returned by `defineSecretManager()` satisfy this. */
export type SecretsConfig = SecretsInput & SecretsDefinitionBrand;

/** A secret value that `tailor deploy` writes only when the secret does not exist yet. */
type CreateOnlySecret<V extends string | null | undefined = string> = {
  readonly create: V;
};

export type SecretsVaultsInput = Record<string, Record<string, string | CreateOnlySecret>>;
export type SecretsVaultsInputNullish = Record<
  string,
  Record<string, string | null | undefined | CreateOnlySecret<string | null | undefined>>
>;

type SecretsOptions = {
  readonly ignoreNullishValues: boolean;
};

/** The `vaults` and `options` that `defineSecretManager()` returns. */
export type SecretsDefinition<T extends SecretsVaultsInputNullish = SecretsVaultsInputNullish> = {
  readonly vaults: T;
  readonly options: SecretsOptions;
};
