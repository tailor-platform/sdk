import type { graphql } from "gql.tada";
import type { Client as UrqlClient } from "@urql/core";

type GQLClient = Pick<UrqlClient, "query" | "mutation">;

type GQLFactoryInput<C> = C & {
  gql: typeof graphql;
  client: GQLClient;
};
export type gqlFactory<C> = (
  input: GQLFactoryInput<C>,
) => ReturnType<typeof input.client.query | typeof input.client.mutation>;
