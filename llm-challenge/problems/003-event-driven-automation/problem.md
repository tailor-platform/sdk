# Event-Driven Automation

## Overview

Build an event-driven automation layer for an order management system using the Tailor Platform SDK. You will implement 5 executors that respond to different types of events: record creation, record updates, resolver execution, scheduled tasks, and incoming webhooks.

## Scaffold

You are given:

- `tailor.config.ts` -- App configuration with DB, resolver, executor, and workflow declarations
- `tailordb/order.ts` -- Order model definition
- `tailordb/auditLog.ts` -- AuditLog model definition
- `resolvers/processAudit/resolver.ts` -- Audit resolver definition
- `workflows/reconciliation.ts` -- Reconciliation workflow definition

## Files to Implement

### 1. `executors/orderCreatedNotify.ts`

An executor that sends a webhook notification when a high-value order is created.

- **Trigger:** `recordCreatedTrigger` on the `order` type (import from `"../tailordb/order"`)
- **Condition:** Only fire when `newRecord.totalAmount > 100` (strictly greater than, not >=)
- **Operation kind:** `webhook`
  - **url:** `` ({ newRecord }) => `https://api.notifications.example.com/orders/${newRecord.id}` ``
  - **headers:**
    - `"Content-Type": "application/json"`
    - `Authorization: { vault: "notification-service", key: "api-key" }`
  - **requestBody:** `({ newRecord }) => ({ orderId: newRecord.id, customerName: newRecord.customerName, totalAmount: newRecord.totalAmount })`
- **name:** `"order-created-notify"`
- **description:** Non-empty string describing the executor

### 2. `executors/orderStatusSync.ts`

An executor that syncs shipment data when an order transitions to "shipped" status.

- **Trigger:** `recordUpdatedTrigger` on the `order` type (import from `"../tailordb/order"`)
- **Condition:** Only fire when transitioning TO `"shipped"` from any other status: `oldRecord.status !== "shipped" && newRecord.status === "shipped"`
- **Operation kind:** `graphql`
  - **query:** `mutation syncShipment($input: ShipmentSyncInput!) { createShipmentSync(input: $input) { id } }`
  - **variables:** `({ newRecord }) => ({ input: { orderId: newRecord.id, customerName: newRecord.customerName, shippingAddress: newRecord.shippingAddress ?? "" } })`
- **name:** `"order-status-sync"`
- **description:** Non-empty string describing the executor

### 3. `executors/auditLog.ts`

An executor that logs results whenever the processAudit resolver is executed.

- **Trigger:** `resolverExecutedTrigger` on the `processAudit` resolver (import default from `"../resolvers/processAudit/resolver"`)
- **Condition:** None (triggers on every execution)
- **Operation kind:** `function`
  - **body:** An async function that checks `args.success`. If true, log with `console.log`. If false, log with `console.error`.
- **name:** `"audit-log"`
- **description:** Non-empty string describing the executor

### 4. `executors/dailyReconciliation.ts`

An executor that runs a reconciliation workflow on a daily schedule.

- **Trigger:** `scheduleTrigger({ cron: "0 2 * * *", timezone: "UTC" })`
- **Operation kind:** `workflow`
  - **workflow:** Import default from `"../workflows/reconciliation"`
  - **args:** `() => ({ date: new Date().toISOString() })`
  - **authInvoker:** `{ namespace: "my-auth", machineUserName: "reconciliation-user" }`
- **name:** `"daily-reconciliation"`
- **description:** Non-empty string describing the executor

### 5. `executors/paymentReceived.ts`

An executor that processes incoming payment webhook notifications.

- **Trigger:** `incomingWebhookTrigger` with typed body: `{ paymentId: string; amount: number; orderId: string }` and headers: `Record<string, string>`
- **Operation kind:** `function`
  - **body:** An async function that:
    1. Reads `args.headers["x-webhook-signature"]`
    2. If the signature is missing or empty string, logs an error with `console.error` and returns
    3. Otherwise, logs the payment details with `console.log`
- **name:** `"payment-received"`
- **description:** Non-empty string describing the executor

## API Reference

```typescript
import {
  createExecutor,
  recordCreatedTrigger,
  recordUpdatedTrigger,
  resolverExecutedTrigger,
  scheduleTrigger,
  incomingWebhookTrigger,
} from "@tailor-platform/sdk";

// Record created trigger
trigger: recordCreatedTrigger({
  type: modelExport,
  condition: ({ newRecord }) => newRecord.totalAmount > 100,
}),

// Record updated trigger
trigger: recordUpdatedTrigger({
  type: modelExport,
  condition: ({ newRecord, oldRecord }) => newRecord.status !== oldRecord.status,
}),

// Resolver executed trigger
trigger: resolverExecutedTrigger({
  resolver: resolverDefaultExport,
  condition: ({ success, result, error }) => success === true,
}),

// Schedule trigger
trigger: scheduleTrigger({ cron: "0 0 * * *", timezone: "UTC" }),

// Incoming webhook trigger
trigger: incomingWebhookTrigger<{
  body: { paymentId: string; amount: number };
  headers: Record<string, string>;
}>(),

// Function operation
operation: {
  kind: "function",
  body: async (args) => { /* args shape depends on trigger */ },
},

// Webhook operation with vault secret
operation: {
  kind: "webhook",
  url: ({ newRecord }) => `https://api.example.com/notify/${newRecord.id}`,
  headers: {
    "Content-Type": "application/json",
    Authorization: { vault: "my-vault", key: "api-key" },
  },
  requestBody: ({ newRecord }) => ({
    orderId: newRecord.id,
    amount: newRecord.totalAmount,
  }),
},

// GraphQL operation
operation: {
  kind: "graphql",
  query: `mutation sync($input: SyncInput!) { sync(input: $input) { id } }`,
  variables: ({ newRecord }) => ({ input: { id: newRecord.id } }),
},

// Workflow operation with auth invoker
operation: {
  kind: "workflow",
  workflow: workflowDefaultExport,
  args: () => ({ date: new Date().toISOString() }),
  authInvoker: { namespace: "my-auth", machineUserName: "system-user" },
},
```

## Scoring

| Stage     | Points  |
| --------- | ------- |
| generate  | 15      |
| typecheck | 25      |
| tests     | 135     |
| **Total** | **175** |
