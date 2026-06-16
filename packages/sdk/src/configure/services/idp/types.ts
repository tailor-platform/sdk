// IdP configuration input types.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.
import type { BuiltinIdP } from "@/types/auth.generated";
import type { IdPInput } from "@/types/idp.generated";

declare const idpDefinitionBrand: unique symbol;
export type IdpDefinitionBrand = { readonly [idpDefinitionBrand]: true };

export type DefinedIdp<Name extends string, Config, ClientNames extends string> = Config & {
  name: Name;
  provider(providerName: string, clientName: ClientNames): BuiltinIdP;
} & IdpDefinitionBrand;

export type IdPExternalConfig = { name: string; external: true };

export type IdPOwnConfig = Omit<DefinedIdp<string, IdPInput, string>, "provider">;

export type IdPConfig = IdPOwnConfig | IdPExternalConfig;
