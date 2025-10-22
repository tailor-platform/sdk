import type { IdPInput } from "@/parser/service/idp/types";
import type { BuiltinIdP } from "@/parser/service/auth/types";

export function defineIdp<const TClients extends readonly string[]>(
  name: string,
  config: Omit<IdPInput, "name" | "clients"> & { clients: TClients },
) {
  return {
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
  } as const satisfies Omit<IdPInput, "clients"> & {
    readonly clients: readonly string[];
    readonly provider: (
      providerName: string,
      clientName: TClients[number],
    ) => BuiltinIdP;
  };
}

export type IdPConfig = ReturnType<typeof defineIdp>;
