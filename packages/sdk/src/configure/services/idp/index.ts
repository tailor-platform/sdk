import type { BuiltinIdP } from "@/parser/service/auth/types";
import type { IdPInput } from "@/parser/service/idp/types";

declare const idpDefinitionBrand: unique symbol;
type IdpDefinitionBrand = { readonly [idpDefinitionBrand]: true };

/**
 * Define an IdP service configuration for the Tailor SDK.
 * @template TClients
 * @param {string} name - IdP service name
 * @param {Omit<IdPInput, "name" | "clients"> & { clients: TClients }} config - IdP configuration
 * @returns {IdpDefinitionBrand & IdPInput} Defined IdP service
 */
export function defineIdp<const TClients extends string[]>(
  name: string,
  config: Omit<IdPInput, "name" | "clients"> & { clients: TClients },
) {
  const result = {
    ...config,
    name,
    provider(providerName: string, clientName: TClients[number]) {
      return {
        name: providerName,
        kind: "BuiltInIdP",
        namespace: name,
        clientName,
      } as const satisfies BuiltinIdP;
    },
  } as const satisfies IdPInput & {
    provider: (providerName: string, clientName: TClients[number]) => BuiltinIdP;
  };

  return result as typeof result & IdpDefinitionBrand;
}

export type IdPExternalConfig = { name: string; external: true };

export type IdPConfig = Omit<ReturnType<typeof defineIdp>, "provider"> | IdPExternalConfig;
