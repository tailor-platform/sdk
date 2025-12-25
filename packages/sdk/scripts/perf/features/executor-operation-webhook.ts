/**
 * Executor Webhook Operation Performance Test
 *
 * Tests type inference cost for webhook operation executors
 * Uses incomingWebhookTrigger (same as other operation tests) to isolate operation cost
 */
import { createExecutor, incomingWebhookTrigger } from "../../../src/configure";

export const executor0 = createExecutor({
  name: "executor0",
  description: "Webhook operation executor 0",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "webhook",
    url: () => "https://api.example.com/webhook/0",
    requestBody: () => ({ data: "test" }),
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "secrets", key: "api-key" },
    },
  },
});

export const executor1 = createExecutor({
  name: "executor1",
  description: "Webhook operation executor 1",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "webhook",
    url: () => "https://api.example.com/webhook/1",
    requestBody: () => ({ data: "test" }),
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "secrets", key: "api-key" },
    },
  },
});

export const executor2 = createExecutor({
  name: "executor2",
  description: "Webhook operation executor 2",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "webhook",
    url: () => "https://api.example.com/webhook/2",
    requestBody: () => ({ data: "test" }),
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "secrets", key: "api-key" },
    },
  },
});

export const executor3 = createExecutor({
  name: "executor3",
  description: "Webhook operation executor 3",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "webhook",
    url: () => "https://api.example.com/webhook/3",
    requestBody: () => ({ data: "test" }),
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "secrets", key: "api-key" },
    },
  },
});

export const executor4 = createExecutor({
  name: "executor4",
  description: "Webhook operation executor 4",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "webhook",
    url: () => "https://api.example.com/webhook/4",
    requestBody: () => ({ data: "test" }),
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "secrets", key: "api-key" },
    },
  },
});

export const executor5 = createExecutor({
  name: "executor5",
  description: "Webhook operation executor 5",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "webhook",
    url: () => "https://api.example.com/webhook/5",
    requestBody: () => ({ data: "test" }),
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "secrets", key: "api-key" },
    },
  },
});

export const executor6 = createExecutor({
  name: "executor6",
  description: "Webhook operation executor 6",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "webhook",
    url: () => "https://api.example.com/webhook/6",
    requestBody: () => ({ data: "test" }),
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "secrets", key: "api-key" },
    },
  },
});

export const executor7 = createExecutor({
  name: "executor7",
  description: "Webhook operation executor 7",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "webhook",
    url: () => "https://api.example.com/webhook/7",
    requestBody: () => ({ data: "test" }),
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "secrets", key: "api-key" },
    },
  },
});

export const executor8 = createExecutor({
  name: "executor8",
  description: "Webhook operation executor 8",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "webhook",
    url: () => "https://api.example.com/webhook/8",
    requestBody: () => ({ data: "test" }),
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "secrets", key: "api-key" },
    },
  },
});

export const executor9 = createExecutor({
  name: "executor9",
  description: "Webhook operation executor 9",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "webhook",
    url: () => "https://api.example.com/webhook/9",
    requestBody: () => ({ data: "test" }),
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "secrets", key: "api-key" },
    },
  },
});
