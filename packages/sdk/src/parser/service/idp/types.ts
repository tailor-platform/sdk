import type { IdPLangSchema, IdPSchema } from "./schema";
import type { BuiltinIdP } from "@/parser/service/auth/types";
import type { z } from "zod";

export type {
  IdPGqlOperations,
  IdPGqlOperationsAliasQuery,
  IdPGqlOperationsConfig,
} from "@/configure/services/idp";

export type IdP = z.output<typeof IdPSchema>;
export type IdPInput = z.input<typeof IdPSchema>;
export type IdPLang = z.output<typeof IdPLangSchema>;

declare const idpDefinitionBrand: unique symbol;
export type IdpDefinitionBrand = { readonly [idpDefinitionBrand]: true };

export type DefinedIdp<Name extends string, Config, ClientNames extends string> = Config & {
  name: Name;
  provider(providerName: string, clientName: ClientNames): BuiltinIdP;
} & IdpDefinitionBrand;

export type IdPExternalConfig = { name: string; external: true };

export type IdPOwnConfig = Omit<DefinedIdp<string, IdPInput, string>, "provider">;

export type IdPConfig = IdPOwnConfig | IdPExternalConfig;
