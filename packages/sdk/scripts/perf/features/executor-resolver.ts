/**
 * Executor Resolver Executed Trigger Performance Test
 *
 * Tests type inference cost for resolver executed trigger executors
 * Uses graphql operation (same as other trigger tests) to isolate trigger cost
 */
import { createExecutor, createResolver, resolverExecutedTrigger, t } from "../../../src/configure";

const dummyResolver = createResolver({
  name: "dummyResolver",
  operation: "query",
  input: { id: t.string() },
  body: async (context) => ({ id: context.input.id, name: "dummy" }),
  output: t.object({ id: t.string(), name: t.string() }),
});

export const executor0 = createExecutor({
  name: "executor0",
  description: "Resolver executed trigger executor 0",
  trigger: resolverExecutedTrigger({ resolver: dummyResolver }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor1 = createExecutor({
  name: "executor1",
  description: "Resolver executed trigger executor 1",
  trigger: resolverExecutedTrigger({ resolver: dummyResolver }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor2 = createExecutor({
  name: "executor2",
  description: "Resolver executed trigger executor 2",
  trigger: resolverExecutedTrigger({ resolver: dummyResolver }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor3 = createExecutor({
  name: "executor3",
  description: "Resolver executed trigger executor 3",
  trigger: resolverExecutedTrigger({ resolver: dummyResolver }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor4 = createExecutor({
  name: "executor4",
  description: "Resolver executed trigger executor 4",
  trigger: resolverExecutedTrigger({ resolver: dummyResolver }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor5 = createExecutor({
  name: "executor5",
  description: "Resolver executed trigger executor 5",
  trigger: resolverExecutedTrigger({ resolver: dummyResolver }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor6 = createExecutor({
  name: "executor6",
  description: "Resolver executed trigger executor 6",
  trigger: resolverExecutedTrigger({ resolver: dummyResolver }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor7 = createExecutor({
  name: "executor7",
  description: "Resolver executed trigger executor 7",
  trigger: resolverExecutedTrigger({ resolver: dummyResolver }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor8 = createExecutor({
  name: "executor8",
  description: "Resolver executed trigger executor 8",
  trigger: resolverExecutedTrigger({ resolver: dummyResolver }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor9 = createExecutor({
  name: "executor9",
  description: "Resolver executed trigger executor 9",
  trigger: resolverExecutedTrigger({ resolver: dummyResolver }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});
