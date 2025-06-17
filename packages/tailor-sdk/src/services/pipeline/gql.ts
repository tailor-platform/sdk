import type { graphql } from 'gql.tada';
import type { Client as UrqlClient } from '@urql/core';

type GQLClient = Pick<UrqlClient, "query" | "mutation">;

type GQLFactoryInput<I, C> = {
  gql: typeof graphql;
  client: GQLClient;
  input: I;
  context: C;
};
export type gqlFactory<I, C> = ({
  gql,
  client,
  input,
  context
}: GQLFactoryInput<I, C>) => ReturnType<typeof client.query | typeof client.mutation>;
