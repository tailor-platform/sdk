import type { IdpDefinitionBrand } from "#src/configure/services/idp/types";
import type { BuiltinIdP } from "#src/types/auth.generated";
import type { IdPInput } from "#src/types/idp.generated";
import type { IdPPermission } from "./permission";

export type {
  IdPEmailConfig,
  IdPGqlOperations,
  IdPGqlOperationsInput as IdPGqlOperationsConfig,
} from "#src/types/idp.generated";

/**
 * Define an IdP service configuration for the Tailor SDK.
 * @template TClients
 * @param name - IdP service name
 * @param config - IdP configuration
 * @returns Defined IdP service
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineIdp<const TClients extends string[]>(
  name: string,
  config: Omit<IdPInput, "name" | "clients" | "permission"> & {
    clients: TClients;
    permission?: IdPPermission;
  },
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

export type { IdPConfig, IdPExternalConfig } from "#src/configure/services/idp/types";

export type { IdPPermission, IdPPermissionCondition } from "./permission";
export { unsafeAllowAllIdPPermission } from "./permission";
