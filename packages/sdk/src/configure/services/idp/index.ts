import type { BuiltinIdP } from "@/parser/service/auth/types";
import type { IdPInput, IdpDefinitionBrand } from "@/parser/service/idp/types";

/**
 * Define an IdP service configuration for the Tailor SDK.
 * @template TClients
 * @param name - IdP service name
 * @param config - IdP configuration
 * @returns Defined IdP service
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

export type { IdPConfig, IdPExternalConfig } from "@/parser/service/idp/types";
