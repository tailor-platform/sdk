import type { SecretsInput } from "#src/types/secrets.generated";

declare const secretsDefinitionBrand: unique symbol;
export type SecretsDefinitionBrand = { readonly [secretsDefinitionBrand]: true };

/** Type accepted by `AppConfig.secrets`. Only values returned by `defineSecretManager()` satisfy this. */
export type SecretsConfig = SecretsInput & SecretsDefinitionBrand;
