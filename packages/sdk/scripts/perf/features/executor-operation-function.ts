/**
 * Executor Function Operation Performance Test
 *
 * Tests type inference cost for function operation executors
 * Uses incomingWebhookTrigger (same as other operation tests) to isolate operation cost
 */
import { createExecutor, incomingWebhookTrigger } from "../../../src/configure";

export const executor0 = createExecutor({
  name: "executor0",
  description: "Function operation executor 0",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "function",
    body: async () => {
      console.log("Function executed 0");
    },
  },
});

export const executor1 = createExecutor({
  name: "executor1",
  description: "Function operation executor 1",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "function",
    body: async () => {
      console.log("Function executed 1");
    },
  },
});

export const executor2 = createExecutor({
  name: "executor2",
  description: "Function operation executor 2",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "function",
    body: async () => {
      console.log("Function executed 2");
    },
  },
});

export const executor3 = createExecutor({
  name: "executor3",
  description: "Function operation executor 3",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "function",
    body: async () => {
      console.log("Function executed 3");
    },
  },
});

export const executor4 = createExecutor({
  name: "executor4",
  description: "Function operation executor 4",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "function",
    body: async () => {
      console.log("Function executed 4");
    },
  },
});

export const executor5 = createExecutor({
  name: "executor5",
  description: "Function operation executor 5",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "function",
    body: async () => {
      console.log("Function executed 5");
    },
  },
});

export const executor6 = createExecutor({
  name: "executor6",
  description: "Function operation executor 6",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "function",
    body: async () => {
      console.log("Function executed 6");
    },
  },
});

export const executor7 = createExecutor({
  name: "executor7",
  description: "Function operation executor 7",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "function",
    body: async () => {
      console.log("Function executed 7");
    },
  },
});

export const executor8 = createExecutor({
  name: "executor8",
  description: "Function operation executor 8",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "function",
    body: async () => {
      console.log("Function executed 8");
    },
  },
});

export const executor9 = createExecutor({
  name: "executor9",
  description: "Function operation executor 9",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "function",
    body: async () => {
      console.log("Function executed 9");
    },
  },
});
