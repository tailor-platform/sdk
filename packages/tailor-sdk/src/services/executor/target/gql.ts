import type { Client } from "@urql/core";
import { type GraphqlOperation, type ManifestAndContext } from "../types";

type UrqlOperationArgs = Parameters<Client["query"] | Client["mutation"]>;

type GraphqlOperationContext<A> = {
  args: A;
};

type GraphqlOperationWithManifestAndContext<A> = ManifestAndContext<
  GraphqlOperation,
  GraphqlOperationContext<A>
>;

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
}): GraphqlOperationWithManifestAndContext<A> {
  return {
    manifest: {
      Kind: "graphql",
      AppName: appName,
      Query: query.toString(),
      Variables: variables
        ? {
            Expr: `(${variables.toString()})(args)`,
          }
        : undefined,
      Invoker: invoker
        ? {
            AuthNamespace: invoker.authName,
            MachineUserName: invoker.machineUser,
          }
        : undefined,
    },
    context: {
      args: undefined as A,
    },
  };
}
