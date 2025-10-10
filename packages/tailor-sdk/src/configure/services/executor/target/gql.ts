import type { Client } from "@urql/core";
import { type GraphqlTarget } from "../types";

type UrqlOperationArgs = Parameters<Client["query"] | Client["mutation"]>;

export function executorGql<A>({
  appName,
  query,
  variables,
  invoker,
}: {
  appName: string;
  query: UrqlOperationArgs[0];
  variables?: (args: A) => UrqlOperationArgs[1];
  invoker?: { authName: string; machineUser: string };
}): GraphqlTarget {
  return {
    Kind: "graphql",
    AppName: appName,
    Query: query.toString(),
    Variables: variables ? `(${variables.toString()})(args)` : undefined,
    Invoker: invoker
      ? {
          AuthNamespace: invoker.authName,
          MachineUserName: invoker.machineUser,
        }
      : undefined,
  };
}
