# 036: Workflow Multi-File

## Goal

Create a workflow where jobs are defined in separate files and re-exported from the main workflow file.

## Instructions

A `tailor.config.ts` is provided that references `./workflows/**/*.ts`.

Create 3 files under `workflows/order/`:

### `workflows/order/validateOrder.ts`

Define and export a workflow job:

- **Name**: `"validate-order"`
- **Body**: Takes `{ orderId: string; items: string[] }` and returns `{ orderId, isValid }` where `isValid` is `true` when `items.length > 0`

### `workflows/order/fulfillOrder.ts`

Define and export a workflow job:

- **Name**: `"fulfill-order"`
- **Body**: Takes `{ orderId: string }` and returns `{ orderId, status: "fulfilled" }`

### `workflows/order/processOrder.ts`

Define the main workflow job and the workflow:

- **Job name**: `"process-order"`
- **Body**: Takes `{ orderId: string; items: string[] }` and:
  1. Triggers `validateOrder` with `{ orderId, items }` and stores the result
  2. Triggers `fulfillOrder` with `{ orderId }` and stores the result
  3. Returns `{ validation, fulfillment }` with the trigger results
- **Workflow name**: `"order-processing"`
- **mainJob**: `processOrder`

This file must also re-export `validateOrder` and `fulfillOrder` as named exports.

## Requirements

- The workflow must be the **default export** of `processOrder.ts`
- All 3 jobs (`processOrder`, `validateOrder`, `fulfillOrder`) must be **named exports** from `processOrder.ts`
- Use `.trigger()` to invoke other jobs (do NOT use `await`)
- Import `createWorkflow` and `createWorkflowJob` from `@tailor-platform/sdk`

## Reference

Refer to the installed SDK package for workflow and job definition patterns.
