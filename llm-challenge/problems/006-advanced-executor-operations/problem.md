# 006: Advanced Executor Operations

## Goal

Build a suite of executors that showcase the diverse operation types available beyond simple functions: scheduled tasks, webhook handling, workflow triggering, outbound webhooks with secrets, and GraphQL mutations with authentication.

## Domain Context

An e-commerce platform needs various automated integrations:

- A daily report runs on a schedule
- A payment provider sends webhook notifications
- New orders trigger a processing workflow
- External services need to be notified of new orders via webhook with API key authentication
- Product updates should sync to an external system via GraphQL

An `order` model, a `processOrder` workflow, and an `updateProduct` resolver are already provided as scaffold.

## What to Build

### 1. `executors/dailyReport.ts` - Scheduled Report

An executor that runs on a cron schedule.

- **Name**: `"daily-report"`
- **Description**: A non-empty string describing the executor
- **Trigger**: Schedule trigger with cron `"0 9 * * *"` and timezone `"Asia/Tokyo"`
- **Operation**: A function that logs a message via `console.log`

### 2. `executors/paymentWebhook.ts` - Incoming Webhook Handler

An executor that handles incoming webhook requests from a payment provider.

- **Name**: `"payment-webhook"`
- **Description**: A non-empty string describing the executor
- **Trigger**: Incoming webhook trigger with typed request including:
  - `body`: `{ eventType: string; paymentId: string; amount: number; currency: string }`
  - `headers`: `{ "x-webhook-secret": string }`
- **Operation**: A function that receives `{ body, headers }` and logs the payment info via `console.log`

### 3. `executors/triggerWorkflow.ts` - Workflow Trigger on Order Creation

An executor that triggers the `processOrder` workflow when a new order is created.

- **Name**: `"order-created-trigger-workflow"`
- **Description**: A non-empty string describing the executor
- **Trigger**: Record created trigger on the `order` type
- **Operation**:
  - Kind: `"workflow"`
  - Reference the `processOrderWorkflow` (default import from `../workflows/processOrder`)
  - `args` function that extracts `orderId` from `triggerArgs.newRecord.id`
- Import `order` from `../tailordb/order`

### 4. `executors/notifyExternal.ts` - Outbound Webhook with Vault Secret

An executor that notifies an external service when a new order is created, using a vault secret for authentication.

- **Name**: `"notify-external-service"`
- **Description**: A non-empty string describing the executor
- **Trigger**: Record created trigger on the `order` type
- **Operation**:
  - Kind: `"webhook"`
  - `url`: A function that builds the URL `https://api.example.com/orders/${args.newRecord.id}`
  - `requestBody`: A function that returns `{ orderId, customerId, totalAmount }` from `args.newRecord`
  - `headers`: Must include `"Content-Type": "application/json"` and `Authorization` as a vault secret object with `vault: "api-secrets"` and `key: "external-api-token"`
- Import `order` from `../tailordb/order`

### 5. `executors/syncData.ts` - GraphQL Operation with Auth

An executor that syncs product data to an external system via GraphQL after a resolver succeeds.

- **Name**: `"sync-product-data"`
- **Description**: A non-empty string describing the executor
- **Trigger**: Resolver executed trigger on the `updateProduct` resolver, with a **condition** that only fires on success (`({ success }) => success`)
- **Operation**:
  - Kind: `"graphql"`
  - `appName`: `"external-sync-app"`
  - `query`: A GraphQL mutation string containing `syncProduct`
  - `variables`: A function that returns variables from `args.result` when successful
  - `authInvoker`: Object with `namespace: "app-auth"` and `machineUserName: "sync-worker"`
- Import the `updateProduct` resolver from `../resolvers/updateProduct/resolver`

## Requirements

- Each file must have a **default export** using `createExecutor`
- Use the appropriate trigger and operation types from the SDK

## Reference

Refer to the installed SDK package for executor definition patterns, trigger types, and operation kinds.
