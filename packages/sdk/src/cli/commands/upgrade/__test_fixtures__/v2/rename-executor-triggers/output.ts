import {
  createExecutor,
  onRecordCreated,
  onRecordUpdated,
  onRecordDeleted,
  onResolverExecuted,
  onSchedule,
  onWebhook,
} from "@tailor-platform/sdk";
import { salesOrder } from "../tailordb/salesOrder";
import sampleWorkflow from "../workflows/sample";

// Executor using onRecordCreated
export const onSalesOrderCreated = createExecutor({
  name: "sales-order-created",
  description: "Triggered when a new sales order is created",
  trigger: onRecordCreated({
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

// Executor using onRecordUpdated
export const onSalesOrderUpdated = createExecutor({
  name: "sales-order-updated",
  description: "Triggered when a sales order is updated",
  trigger: onRecordUpdated({
    type: salesOrder,
  }),
  operation: {
    kind: "function",
    body: ({ newRecord, oldRecord }) => {
      console.log("Updated:", oldRecord.id, "->", newRecord.id);
    },
  },
});

// Executor using onRecordDeleted
export const onSalesOrderDeleted = createExecutor({
  name: "sales-order-deleted",
  description: "Triggered when a sales order is deleted",
  trigger: onRecordDeleted({
    type: salesOrder,
  }),
  operation: {
    kind: "function",
    body: ({ oldRecord }) => {
      console.log("Deleted:", oldRecord.id);
    },
  },
});

// Executor using onResolverExecuted
export const onResolverDone = createExecutor({
  name: "resolver-done",
  description: "Triggered after a resolver executes",
  trigger: onResolverExecuted({
    resolver: "myResolver",
  }),
  operation: {
    kind: "function",
    body: (args) => {
      console.log("Resolver executed:", args);
    },
  },
});

// Executor using onSchedule
export const dailyJob = createExecutor({
  name: "daily-workflow",
  description: "Scheduled workflow executor",
  trigger: onSchedule({
    cron: "0 12 * * *",
    timezone: "Asia/Tokyo",
  }),
  operation: {
    kind: "workflow",
    workflow: sampleWorkflow,
    args: () => ({ orderId: "daily-workflow-order" }),
  },
});

// Executor using onWebhook
export const webhook = createExecutor({
  name: "test-webhook",
  description: "Test executor for incoming webhook trigger",
  trigger: onWebhook<{
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
