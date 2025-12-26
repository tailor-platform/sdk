/**
 * Executor Workflow Operation Performance Test
 *
 * Tests type inference cost for workflow operation executors
 * Uses incomingWebhookTrigger (same as other operation tests) to isolate operation cost
 */
import {
  createExecutor,
  createWorkflow,
  createWorkflowJob,
  incomingWebhookTrigger,
} from "../../../src/configure";

const mainJob = createWorkflowJob({
  name: "mainJob",
  body: (input: { id: string }) => {
    console.log("Processing", input.id);
    return { processed: true };
  },
});

const workflow = createWorkflow({
  name: "dummyWorkflow",
  mainJob,
});

export const executor0 = createExecutor({
  name: "executor0",
  description: "Workflow operation executor 0",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "workflow",
    workflow,
    args: { id: "0" },
  },
});

export const executor1 = createExecutor({
  name: "executor1",
  description: "Workflow operation executor 1",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "workflow",
    workflow,
    args: { id: "1" },
  },
});

export const executor2 = createExecutor({
  name: "executor2",
  description: "Workflow operation executor 2",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "workflow",
    workflow,
    args: { id: "2" },
  },
});

export const executor3 = createExecutor({
  name: "executor3",
  description: "Workflow operation executor 3",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "workflow",
    workflow,
    args: { id: "3" },
  },
});

export const executor4 = createExecutor({
  name: "executor4",
  description: "Workflow operation executor 4",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "workflow",
    workflow,
    args: { id: "4" },
  },
});

export const executor5 = createExecutor({
  name: "executor5",
  description: "Workflow operation executor 5",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "workflow",
    workflow,
    args: { id: "5" },
  },
});

export const executor6 = createExecutor({
  name: "executor6",
  description: "Workflow operation executor 6",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "workflow",
    workflow,
    args: { id: "6" },
  },
});

export const executor7 = createExecutor({
  name: "executor7",
  description: "Workflow operation executor 7",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "workflow",
    workflow,
    args: { id: "7" },
  },
});

export const executor8 = createExecutor({
  name: "executor8",
  description: "Workflow operation executor 8",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "workflow",
    workflow,
    args: { id: "8" },
  },
});

export const executor9 = createExecutor({
  name: "executor9",
  description: "Workflow operation executor 9",
  trigger: incomingWebhookTrigger(),
  operation: {
    kind: "workflow",
    workflow,
    args: { id: "9" },
  },
});
