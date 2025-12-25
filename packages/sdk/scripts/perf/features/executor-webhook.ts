/**
 * Executor Webhook Trigger Performance Test
 *
 * Tests type inference cost for incoming webhook trigger executors
 */
import { createExecutor, incomingWebhookTrigger } from "../../../src/configure";

export const executor0 = createExecutor({
  name: "executor0",
  description: "Webhook executor 0",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { process(data: $data) }`,
    variables: () => ({ data: "webhook-data" }),
  },
});

export const executor1 = createExecutor({
  name: "executor1",
  description: "Webhook executor 1",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { process(data: $data) }`,
    variables: () => ({ data: "webhook-data" }),
  },
});

export const executor2 = createExecutor({
  name: "executor2",
  description: "Webhook executor 2",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { process(data: $data) }`,
    variables: () => ({ data: "webhook-data" }),
  },
});

export const executor3 = createExecutor({
  name: "executor3",
  description: "Webhook executor 3",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { process(data: $data) }`,
    variables: () => ({ data: "webhook-data" }),
  },
});

export const executor4 = createExecutor({
  name: "executor4",
  description: "Webhook executor 4",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { process(data: $data) }`,
    variables: () => ({ data: "webhook-data" }),
  },
});

export const executor5 = createExecutor({
  name: "executor5",
  description: "Webhook executor 5",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { process(data: $data) }`,
    variables: () => ({ data: "webhook-data" }),
  },
});

export const executor6 = createExecutor({
  name: "executor6",
  description: "Webhook executor 6",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { process(data: $data) }`,
    variables: () => ({ data: "webhook-data" }),
  },
});

export const executor7 = createExecutor({
  name: "executor7",
  description: "Webhook executor 7",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { process(data: $data) }`,
    variables: () => ({ data: "webhook-data" }),
  },
});

export const executor8 = createExecutor({
  name: "executor8",
  description: "Webhook executor 8",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { process(data: $data) }`,
    variables: () => ({ data: "webhook-data" }),
  },
});

export const executor9 = createExecutor({
  name: "executor9",
  description: "Webhook executor 9",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { process(data: $data) }`,
    variables: () => ({ data: "webhook-data" }),
  },
});
