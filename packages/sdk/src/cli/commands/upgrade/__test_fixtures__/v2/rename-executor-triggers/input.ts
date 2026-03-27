import {
  createExecutor,
  recordCreatedTrigger,
  recordUpdatedTrigger,
  recordDeletedTrigger,
  resolverExecutedTrigger,
  scheduleTrigger,
  incomingWebhookTrigger,
} from "@tailor-platform/sdk";
import { salesOrder } from "../tailordb/salesOrder";
import sampleWorkflow from "../workflows/sample";

// Executor using recordCreatedTrigger
export const onSalesOrderCreated = createExecutor({
  name: "sales-order-created",
  description: "Triggered when a new sales order is created",
  trigger: recordCreatedTrigger({
    type: salesOrder,
    condition: ({ newRecord }) => (newRecord.totalPrice ?? 0) > 100_0000,
  }),
  operation: {
    kind: "graphql",
    query: /* gql */ `
      mutation createLog($input: LogCreateInput!) {
        createLog(input: $input) { id }
      }
    `,
    variables: ({ newRecord }) => ({
      input: { salesOrderID: newRecord.id },
    }),
  },
});

// Executor using recordUpdatedTrigger
export const onSalesOrderUpdated = createExecutor({
  name: "sales-order-updated",
  description: "Triggered when a sales order is updated",
  trigger: recordUpdatedTrigger({
    type: salesOrder,
  }),
  operation: {
    kind: "function",
    body: ({ newRecord, oldRecord }) => {
      console.log("Updated:", oldRecord.id, "->", newRecord.id);
    },
  },
});

// Executor using recordDeletedTrigger
export const onSalesOrderDeleted = createExecutor({
  name: "sales-order-deleted",
  description: "Triggered when a sales order is deleted",
  trigger: recordDeletedTrigger({
    type: salesOrder,
  }),
  operation: {
    kind: "function",
    body: ({ oldRecord }) => {
      console.log("Deleted:", oldRecord.id);
    },
  },
});

// Executor using resolverExecutedTrigger
export const onResolverDone = createExecutor({
  name: "resolver-done",
  description: "Triggered after a resolver executes",
  trigger: resolverExecutedTrigger({
    resolver: "myResolver",
  }),
  operation: {
    kind: "function",
    body: (args) => {
      console.log("Resolver executed:", args);
    },
  },
});

// Executor using scheduleTrigger
export const dailyJob = createExecutor({
  name: "daily-workflow",
  description: "Scheduled workflow executor",
  trigger: scheduleTrigger({
    cron: "0 12 * * *",
    timezone: "Asia/Tokyo",
  }),
  operation: {
    kind: "workflow",
    workflow: sampleWorkflow,
    args: () => ({ orderId: "daily-workflow-order" }),
  },
});

// Executor using incomingWebhookTrigger
export const webhook = createExecutor({
  name: "test-webhook",
  description: "Test executor for incoming webhook trigger",
  trigger: incomingWebhookTrigger<{
    body: { message: string };
    headers: Record<string, string>;
  }>(),
  operation: {
    kind: "function",
    body: (args) => {
      console.log("Webhook received:", args.body);
    },
  },
});
