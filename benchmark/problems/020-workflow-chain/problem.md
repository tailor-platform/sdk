# 020: Workflow Chain

## Goal

Create a workflow that chains 3 jobs together for order fulfillment: check inventory, process payment, and fulfill the order.

## Instructions

Create the file `workflows/order-fulfillment.ts` that defines 3 workflow jobs and a workflow.

### Jobs

Define the following jobs using `createWorkflowJob`:

| Job            | Name            | Input                                 | Output                                                                              |
| -------------- | --------------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| checkInventory | check-inventory | `{ orderId: string }`                 | `{ available: true, orderId: <input orderId> }`                                     |
| processPayment | process-payment | `{ orderId: string; amount: number }` | `{ paid: true, transactionId: "txn-" + orderId }`                                   |
| fulfillOrder   | fulfill-order   | `{ orderId: string; amount: number }` | `{ orderId, inventory: <checkInventory result>, payment: <processPayment result> }` |

The `fulfillOrder` job is the main job. Its body must:

1. Call `checkInventory.trigger({ orderId: input.orderId })` and store the result
2. Call `processPayment.trigger({ orderId: input.orderId, amount: input.amount })` and store the result
3. Return an object with `orderId`, `inventory` (checkInventory result), and `payment` (processPayment result)

### Workflow

Define a workflow using `createWorkflow`:

- name: `"order-fulfillment"`
- mainJob: `fulfillOrder`

## Requirements

- Import `createWorkflow` and `createWorkflowJob` from `@tailor-platform/sdk`
- The workflow must be the **default export**
- All 3 jobs (`checkInventory`, `processPayment`, `fulfillOrder`) must be **named exports**
- `.trigger()` returns the result synchronously on the server side. You should assign the return value directly (do NOT use `await` — it's optional but not necessary)

## Example

Refer to the SDK documentation for workflow patterns using `createWorkflow` and `createWorkflowJob`.
