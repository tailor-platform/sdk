import type { BuiltinIdP } from "@/types/auth";
import type { IdPInput } from "@/types/idp";
import type { IdpDefinitionBrand } from "@/types/idp.manual";

/**
 * Configuration for GraphQL operations on IdP users.
 * All operations are enabled by default (undefined or true = enabled, false = disabled).
 */
export interface IdPGqlOperations {
  /** Enable _createUser mutation (default: true) */
  create?: boolean;
  /** Enable _updateUser mutation (default: true) */
  update?: boolean;
  /** Enable _deleteUser mutation (default: true) */
  delete?: boolean;
  /** Enable _users and _user queries (default: true) */
  read?: boolean;
  /** Enable _sendPasswordResetEmail mutation (default: true) */
  sendPasswordResetEmail?: boolean;
}

/**
 * Alias for common IdPGqlOperations configurations.
 * - "query": Read-only mode - disables all mutations (create, update, delete, sendPasswordResetEmail)
 */
export type IdPGqlOperationsAliasQuery = "query";

/**
 * Configuration for GraphQL operations - either an alias string or detailed object.
 */
export type IdPGqlOperationsConfig = IdPGqlOperationsAliasQuery | IdPGqlOperations;

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

export type { IdPConfig, IdPExternalConfig } from "@/types/idp.manual";
