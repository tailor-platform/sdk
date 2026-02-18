# 007: Workflow Orchestration

## Goal

Build a multi-file order fulfillment workflow that chains multiple jobs together. Each job is defined in its own file and the main job orchestrates them by triggering each one.

## Domain Context

An e-commerce system processes orders through a pipeline:

1. **Check inventory** to confirm the ordered items are in stock
2. **Process payment** to charge the customer
3. **Ship the order** to dispatch it for delivery

The main `fulfillOrder` job coordinates all three steps and returns a combined result.

## What to Build

### 1. `workflows/fulfillment/checkInventory.ts` - Inventory Check Job

A workflow job that verifies inventory availability.

- **Job name**: `"check-inventory"`
- **Input**: `{ orderId: string }`
- **Returns**: `{ available: true, orderId: <input orderId> }`
- Export as **named export** `checkInventory`

### 2. `workflows/fulfillment/processPayment.ts` - Payment Processing Job

A workflow job that handles payment.

- **Job name**: `"process-payment"`
- **Input**: `{ orderId: string; amount: number }`
- **Returns**: `{ paid: true, transactionId: "txn-" + <input orderId> }`
- Export as **named export** `processPayment`

### 3. `workflows/fulfillment/shipOrder.ts` - Shipping Job

A workflow job that dispatches the order.

- **Job name**: `"ship-order"`
- **Input**: `{ orderId: string }`
- **Returns**: `{ shipped: true, orderId: <input orderId>, trackingId: "TRK-001" }`
- Export as **named export** `shipOrder`

### 4. `workflows/fulfillment/fulfillOrder.ts` - Main Orchestrator

The main workflow job that chains all three jobs, plus the workflow definition.

- **Job name**: `"fulfill-order"`
- **Input**: `{ orderId: string; amount: number }`
- **Body**: Triggers `checkInventory`, `processPayment`, and `shipOrder` using `.trigger()`, and returns an object with keys `inventory`, `payment`, and `shipping` containing their respective results
- **Workflow**: Named `"order-fulfillment"` with `mainJob` set to `fulfillOrder`

This file must:

- **Default export** the workflow (result of `createWorkflow`)
- **Named export** all 4 jobs: `fulfillOrder`, `checkInventory`, `processPayment`, `shipOrder` (re-export the imported ones)

## Requirements

- Each job file must use `createWorkflowJob` from the SDK
- The workflow file must use `createWorkflow` from the SDK
- All job names must be unique
- Use `.trigger()` to invoke other jobs from the main job (do NOT use `await` with `.trigger()`)

## Reference

Refer to the installed SDK package for workflow and job definition patterns.
