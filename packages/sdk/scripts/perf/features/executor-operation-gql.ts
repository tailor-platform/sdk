/**
 * Executor GQL Operation Performance Test
 *
 * Tests type inference cost for GraphQL operation executors
 * Uses incomingWebhookTrigger (same as other operation tests) to isolate operation cost
 */
import { createExecutor, incomingWebhookTrigger } from "../../../src/configure";

const query = `
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
    }
  }
`;

export const executor0 = createExecutor({
  name: "executor0",
  description: "GQL operation executor 0",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query,
    variables: () => ({ id: "1" }),
  },
});

export const executor1 = createExecutor({
  name: "executor1",
  description: "GQL operation executor 1",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query,
    variables: () => ({ id: "2" }),
  },
});

export const executor2 = createExecutor({
  name: "executor2",
  description: "GQL operation executor 2",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query,
    variables: () => ({ id: "3" }),
  },
});

export const executor3 = createExecutor({
  name: "executor3",
  description: "GQL operation executor 3",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query,
    variables: () => ({ id: "4" }),
  },
});

export const executor4 = createExecutor({
  name: "executor4",
  description: "GQL operation executor 4",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query,
    variables: () => ({ id: "5" }),
  },
});

export const executor5 = createExecutor({
  name: "executor5",
  description: "GQL operation executor 5",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query,
    variables: () => ({ id: "6" }),
  },
});

export const executor6 = createExecutor({
  name: "executor6",
  description: "GQL operation executor 6",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query,
    variables: () => ({ id: "7" }),
  },
});

export const executor7 = createExecutor({
  name: "executor7",
  description: "GQL operation executor 7",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query,
    variables: () => ({ id: "8" }),
  },
});

export const executor8 = createExecutor({
  name: "executor8",
  description: "GQL operation executor 8",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query,
    variables: () => ({ id: "9" }),
  },
});

export const executor9 = createExecutor({
  name: "executor9",
  description: "GQL operation executor 9",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    query,
    variables: () => ({ id: "10" }),
  },
});
