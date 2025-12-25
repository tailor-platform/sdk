/**
 * Executor Schedule Trigger Performance Test
 *
 * Tests type inference cost for schedule trigger executors
 */
import { createExecutor, scheduleTrigger } from "../../../src/configure";

export const executor0 = createExecutor({
  name: "executor0",
  description: "Scheduled executor 0",
  trigger: scheduleTrigger({ cron: "0 0 * * *" }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor1 = createExecutor({
  name: "executor1",
  description: "Scheduled executor 1",
  trigger: scheduleTrigger({ cron: "0 1 * * *" }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor2 = createExecutor({
  name: "executor2",
  description: "Scheduled executor 2",
  trigger: scheduleTrigger({ cron: "0 2 * * *" }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor3 = createExecutor({
  name: "executor3",
  description: "Scheduled executor 3",
  trigger: scheduleTrigger({ cron: "0 3 * * *" }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor4 = createExecutor({
  name: "executor4",
  description: "Scheduled executor 4",
  trigger: scheduleTrigger({ cron: "0 4 * * *" }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor5 = createExecutor({
  name: "executor5",
  description: "Scheduled executor 5",
  trigger: scheduleTrigger({ cron: "0 5 * * *" }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor6 = createExecutor({
  name: "executor6",
  description: "Scheduled executor 6",
  trigger: scheduleTrigger({ cron: "0 6 * * *" }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor7 = createExecutor({
  name: "executor7",
  description: "Scheduled executor 7",
  trigger: scheduleTrigger({ cron: "0 7 * * *" }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor8 = createExecutor({
  name: "executor8",
  description: "Scheduled executor 8",
  trigger: scheduleTrigger({ cron: "0 8 * * *" }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor9 = createExecutor({
  name: "executor9",
  description: "Scheduled executor 9",
  trigger: scheduleTrigger({ cron: "0 9 * * *" }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});
