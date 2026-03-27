import { createExecutor } from "@tailor-platform/sdk";
import {
  recordCreatedTrigger,
  recordDeletedTrigger,
  resolverExecutedTrigger,
  scheduleTrigger,
  incomingWebhookTrigger,
} from "@tailor-platform/sdk/trigger";
import { auth } from "../tailor.config";
import sampleWorkflow from "../workflows/sample";

export const onUserCreated = createExecutor({
  name: "user-created",
  trigger: recordCreatedTrigger({ type: "User" }),
  operation: {
    kind: "function",
    function: async ({ newRecord }) => {
      console.log(newRecord);
    },
  },
});

export const onUserDeleted = createExecutor({
  name: "user-deleted",
  trigger: recordDeletedTrigger({ type: "User" }),
  operation: {
    kind: "function",
    function: async ({ oldRecord }) => {
      console.log(oldRecord);
    },
  },
});

export const onResolverRan = createExecutor({
  name: "resolver-executed",
  trigger: resolverExecutedTrigger({ resolver: "createOrder" }),
  operation: {
    kind: "workflow",
    workflow: sampleWorkflow,
    args: ({ result }) => ({ orderId: result.id }),
    invoker: auth.machineUser("manager-machine-user"),
  },
});

export const dailySync = createExecutor({
  name: "daily-sync",
  trigger: scheduleTrigger({ cron: "0 0 * * *" }),
  operation: {
    kind: "workflow",
    workflow: sampleWorkflow,
    args: () => ({ mode: "sync" }),
  },
});

export const webhookHandler = createExecutor({
  name: "webhook-handler",
  trigger: incomingWebhookTrigger({ name: "stripe-webhook" }),
  operation: {
    kind: "function",
    function: async ({ payload }) => {
      console.log(payload);
    },
  },
});
