import { createExecutor } from "@tailor-platform/sdk";
import {
  onRecordCreated,
  onRecordDeleted,
  onResolverExecuted,
  onSchedule,
  onIncomingWebhook,
} from "@tailor-platform/sdk/trigger";
import { auth } from "../tailor.config";
import sampleWorkflow from "../workflows/sample";

export const onUserCreated = createExecutor({
  name: "user-created",
  trigger: onRecordCreated({ type: "User" }),
  operation: {
    kind: "function",
    function: async ({ newRecord }) => {
      console.log(newRecord);
    },
  },
});

export const onUserDeleted = createExecutor({
  name: "user-deleted",
  trigger: onRecordDeleted({ type: "User" }),
  operation: {
    kind: "function",
    function: async ({ oldRecord }) => {
      console.log(oldRecord);
    },
  },
});

export const onResolverRan = createExecutor({
  name: "resolver-executed",
  trigger: onResolverExecuted({ resolver: "createOrder" }),
  operation: {
    kind: "workflow",
    workflow: sampleWorkflow,
    args: ({ result }) => ({ orderId: result.id }),
    invoker: auth.machineUser("manager-machine-user"),
  },
});

export const dailySync = createExecutor({
  name: "daily-sync",
  trigger: onSchedule({ cron: "0 0 * * *" }),
  operation: {
    kind: "workflow",
    workflow: sampleWorkflow,
    args: () => ({ mode: "sync" }),
  },
});

export const webhookHandler = createExecutor({
  name: "webhook-handler",
  trigger: onIncomingWebhook({ name: "stripe-webhook" }),
  operation: {
    kind: "function",
    function: async ({ payload }) => {
      console.log(payload);
    },
  },
});
