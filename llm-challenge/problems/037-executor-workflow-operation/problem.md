# 037: Executor Workflow Operation

## Goal

Create an executor that triggers a workflow when a new record is created.

## Instructions

The following files are already provided:

- `tailordb/order.ts` — An `Order` model with fields: `customerId` (uuid), `totalAmount` (float), `status` (enum: pending, processing, shipped, delivered)
- `workflows/processOrder.ts` — A workflow with a `processOrderJob` that takes `{ orderId: string }` and returns `{ processed: true, orderId }`
- `tailor.config.ts` — Configuration referencing executor and workflow directories

Create the file `executors/triggerWorkflow.ts` with a **default export** that defines an executor.

## Requirements

- **Name**: `"order-created-trigger-workflow"`
- **Description**: A non-empty string describing the executor
- **Trigger**: Triggered when a new `Order` record is created (use `recordCreatedTrigger`)
- **Operation**:
  - Kind: `"workflow"`
  - workflow: reference to the imported `processOrderWorkflow` (the default export from `../workflows/processOrder`)
  - args: a function that receives trigger args and returns `{ orderId: triggerArgs.newRecord.id }`
- Import the `order` type from `../tailordb/order`
- Import the workflow default export from `../workflows/processOrder`

## Reference

Refer to the installed SDK package for executor definition patterns.
