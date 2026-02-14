# 012: Fix Broken Workflow

## Goal

Fix a broken workflow file that contains multiple common mistakes. The workflow defines an order processing pipeline with 3 jobs.

## Instructions

The file `workflows/orderPipeline.ts` is provided but contains several bugs. Find and fix all of them.

The workflow should have 3 jobs:

| Job             | Name             | Input                                 | Output                                                                |
| --------------- | ---------------- | ------------------------------------- | --------------------------------------------------------------------- |
| validatePayment | validate-payment | `{ orderId: string; amount: number }` | `{ valid: input.amount > 0, orderId: input.orderId }`                 |
| shipOrder       | ship-order       | `{ orderId: string }`                 | `{ shipped: true, orderId: input.orderId, trackingId: "TRK-001" }`    |
| processOrder    | process-order    | `{ orderId: string; amount: number }` | `{ payment: <validatePayment result>, shipping: <shipOrder result> }` |

The `processOrder` job is the main job. Its body must:

1. Invoke `validatePayment` with `{ orderId: input.orderId, amount: input.amount }`
2. Invoke `shipOrder` with `{ orderId: input.orderId }`
3. Return an object with `payment` and `shipping` results

### Workflow

- name: `"order-pipeline"`
- mainJob: `processOrder`

## Broken Code

```typescript
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

const validatePayment = createWorkflowJob({
  name: "validate-payment",
  body: (input: { orderId: string; amount: number }) => {
    return { valid: input.amount > 0, orderId: input.orderId };
  },
});

const shipOrder = createWorkflowJob({
  name: "ship-order",
  body: (input: { orderId: string }) => {
    return { shipped: true, trackingId: "TRK-001" };
  },
});

const processOrder = createWorkflowJob({
  name: "validate-payment",
  body: async (input: { orderId: string; amount: number }) => {
    const payment = await validatePayment.trigger({ orderId: input.orderId, amount: input.amount });
    const shipping = await shipOrder.trigger({ orderId: input.orderId });
    return { payment, shipping };
  },
});

const orderPipeline = createWorkflow({
  name: "order_pipeline",
  mainJob: processOrder,
});
```

## Requirements

- The workflow must be the **default export**
- All 3 jobs must be **named exports**
- All job names must be **unique**
- Job invocations (`.trigger()`) must not use `await`
- `shipOrder` body must return `orderId` from input
- Workflow name must use hyphens, not underscores

## Reference

Refer to the installed SDK package for workflow and job definition patterns.
