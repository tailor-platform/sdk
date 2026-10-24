// IdP configuration input types.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.
import type { IdPPermission } from "#/configure/services/idp/permission";
import type { BuiltinIdP } from "#/types/auth.generated";
import type { IdPInput } from "#/types/idp.generated";

declare const idpDefinitionBrand: unique symbol;
export type IdpDefinitionBrand = { readonly [idpDefinitionBrand]: true };

type DefinedIdp<Name extends string, Config, ClientNames extends string> = Config & {
  name: Name;
  provider(providerName: string, clientName: ClientNames): BuiltinIdP;
} & IdpDefinitionBrand;

type IdPNonOwnedOptions = {
  [Key in Exclude<keyof IdPOwnConfig, "name" | "external" | "attach">]?: never;
};

export type IdPExternalConfig = IdPNonOwnedOptions & {
  name: string;
  /** @deprecated since NEXT_RELEASE — use `attach: true` instead. codemod: v3/external-to-attach */
  external: true;
  attach?: never;
};

export type IdPAttachedConfig = IdPNonOwnedOptions & {
  name: string;
  attach: true;
  external?: never;
};

type IdPOwnConfigInput = Omit<IdPInput, "permission"> & { permission?: IdPPermission };

export type IdPOwnConfig = Omit<DefinedIdp<string, IdPOwnConfigInput, string>, "provider"> & {
  external?: never;
  attach?: never;
};

export type IdPConfig = IdPOwnConfig | IdPExternalConfig | IdPAttachedConfig;
