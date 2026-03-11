import type { BuiltinIdP } from "./auth.generated";
import type { IdPInput } from "./idp.generated";

declare const idpDefinitionBrand: unique symbol;
export type IdpDefinitionBrand = { readonly [idpDefinitionBrand]: true };

export type DefinedIdp<Name extends string, Config, ClientNames extends string> = Config & {
  name: Name;
  provider(providerName: string, clientName: ClientNames): BuiltinIdP;
} & IdpDefinitionBrand;

export type IdPExternalConfig = { name: string; external: true };

export type IdPOwnConfig = Omit<DefinedIdp<string, IdPInput, string>, "provider">;

export type IdPConfig = IdPOwnConfig | IdPExternalConfig;
