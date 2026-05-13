# Await a child job's trigger result inside a workflow

## Goal

Build an order-processing workflow whose main job triggers a child job and
uses the child's return value to construct its own response.

## Domain Context

A storefront places an order. The main `processOrder` job needs the total
price computed by a separate `calculateTotal` job; the result of
`calculateTotal` must flow back into the main job's response. The child job
returns a `{ total: number }` object that the main job re-exposes as part
of its own output.

## What to Build

Create `workflows/orderFlow.ts` that exports:

- A named export `calculateTotal`: a workflow job named `"calculate-total"`
  that takes `{ quantity: number; unitPrice: number }` and returns
  `{ total: number }` (multiplication).
- A named export `processOrder`: a workflow job named `"process-order"`
  whose body takes `{ orderId: string; quantity: number; unitPrice: number }`
  and returns `{ orderId: string; total: number }`. The body must invoke
  `calculateTotal.trigger(...)` and incorporate its `total` into the
  response.
- A default export `createWorkflow({ name: "order-flow", mainJob: processOrder })`.

## Requirements

- The workflow's default export must be the value returned by
  `createWorkflow`.
- `calculateTotal` and `processOrder` must both be named exports.
- The main job must consume the trigger result; the test harness replaces
  the child job's response via the standard workflow-mock and asserts that
  the main job's output reflects it.

## Reference

Refer to the installed SDK package for workflow job authoring. No external
documentation is required for this task.
