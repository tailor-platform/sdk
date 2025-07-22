import type { Client } from "@urql/core";
import { GraphqlOperation, ManifestAndContext } from "../types";

type UrqlOperationArgs = Parameters<Client["query"] | Client["mutation"]>;

type GraphqlOperationContext<A> = {
  args: A;
};

type GraphqlOperationWithManifestAndContext<A> = ManifestAndContext<
  GraphqlOperation,
  GraphqlOperationContext<A>
>;

export function executorGql<A>({
  query,
  variables,
}: {
  appName: string;
  query: UrqlOperationArgs[0];
  variables?: (args: A) => UrqlOperationArgs[1];
}): GraphqlOperationWithManifestAndContext<A> {
  return {
    manifest: {
      Kind: "graphql",
      Query: query.toString(),
      Variables: variables
        ? {
            Expr: `(${JSON.stringify(variables)})(args)`,
          }
        : undefined,
    },
    context: {
      args: undefined as A,
    },
  };
}
