/**
 * Executor GQL Operation Performance Test (Literal Query)
 *
 * Tests type inference cost when GraphQL query strings are literal types
 * WITH a populated GeneratedGqlSchema. This exercises the full template
 * literal parsing pipeline: ExtractRootField, _ExtractVarBlock,
 * _ExtractVarNames, _MergeVarNamesWithSchema, and ValidateGqlQuery.
 *
 * Compare with executor-operation-gql.ts which uses `: string` annotation
 * and only measures the permissive (non-literal) fallback path.
 */
import { createExecutor, incomingWebhookTrigger, db } from "../../../src/configure";
import type { InferCreateInput, InferGqlResult } from "../../../src/graphql/infer";

const dummyType = db.type("PerfDummy", {
  name: db.string(),
  age: db.int({ optional: true }),
  email: db.string(),
});

// Augment GeneratedGqlSchema so the literal parser path is exercised
declare module "../../../src/graphql/infer" {
  interface GeneratedGqlSchema {
    perfDummy: {
      variables: { id: string };
      result: { perfDummy: InferGqlResult<typeof dummyType> | null };
    };
    createPerfDummy: {
      variables: { input: InferCreateInput<typeof dummyType> };
      result: { createPerfDummy: InferGqlResult<typeof dummyType> };
    };
  }
  interface GeneratedGqlTypeNames {
    PerfDummyCreateInput: true;
  }
}

// Literal queries — exercises template literal type parsing
export const executor0 = createExecutor({
  name: "executor0",
  description: "Literal GQL executor 0",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query: `query { perfDummy(id: $id) { id name } }`,
    variables: () => ({ id: "1" }),
  },
});

export const executor1 = createExecutor({
  name: "executor1",
  description: "Literal GQL executor 1",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query: `mutation { createPerfDummy(input: $input) { id name } }`,
    variables: () => ({ input: { name: "test", email: "a@b.com" } }),
  },
});

export const executor2 = createExecutor({
  name: "executor2",
  description: "Literal GQL executor 2",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query: `query ($id: ID!) { perfDummy(id: $id) { id name age email } }`,
    variables: () => ({ id: "2" }),
  },
});

export const executor3 = createExecutor({
  name: "executor3",
  description: "Literal GQL executor 3",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query: `mutation ($input: PerfDummyCreateInput!) { createPerfDummy(input: $input) { id } }`,
    variables: () => ({ input: { name: "test3", email: "c@d.com" } }),
  },
});

export const executor4 = createExecutor({
  name: "executor4",
  description: "Literal GQL executor 4",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query: `query { perfDummy(id: $id) { id email } }`,
    variables: () => ({ id: "4" }),
  },
});

export const executor5 = createExecutor({
  name: "executor5",
  description: "Literal GQL executor 5",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query: `mutation { createPerfDummy(input: $input) { id email } }`,
    variables: () => ({ input: { name: "test5", email: "e@f.com" } }),
  },
});

export const executor6 = createExecutor({
  name: "executor6",
  description: "Literal GQL executor 6",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query: `query ($id: ID!) { perfDummy(id: $id) { id name } }`,
    variables: () => ({ id: "6" }),
  },
});

export const executor7 = createExecutor({
  name: "executor7",
  description: "Literal GQL executor 7",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query: `mutation ($input: PerfDummyCreateInput!) { createPerfDummy(input: $input) { id name email } }`,
    variables: () => ({ input: { name: "test7", email: "g@h.com" } }),
  },
});

export const executor8 = createExecutor({
  name: "executor8",
  description: "Literal GQL executor 8",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query: `query { perfDummy(id: $id) { id age } }`,
    variables: () => ({ id: "8" }),
  },
});

export const executor9 = createExecutor({
  name: "executor9",
  description: "Literal GQL executor 9",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query: `mutation { createPerfDummy(input: $input) { id name age email } }`,
    variables: () => ({ input: { name: "test9", email: "i@j.com" } }),
  },
});
