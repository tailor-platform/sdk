# 020: Workflow Chain

## Goal

Create a workflow that chains 3 jobs together for order fulfillment: check inventory, process payment, and fulfill the order.

## Instructions

Create the file `workflows/order-fulfillment.ts` that defines 3 workflow jobs and a workflow.

### Jobs

| Job            | Name            | Input                                 | Output                                                                              |
| -------------- | --------------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| checkInventory | check-inventory | `{ orderId: string }`                 | `{ available: true, orderId: <input orderId> }`                                     |
| processPayment | process-payment | `{ orderId: string; amount: number }` | `{ paid: true, transactionId: "txn-" + orderId }`                                   |
| fulfillOrder   | fulfill-order   | `{ orderId: string; amount: number }` | `{ orderId, inventory: <checkInventory result>, payment: <processPayment result> }` |

The `fulfillOrder` job is the main job. Its body must:

1. Invoke the `checkInventory` job with `{ orderId: input.orderId }` and store the result
2. Invoke the `processPayment` job with `{ orderId: input.orderId, amount: input.amount }` and store the result
3. Return an object with `orderId`, `inventory` (checkInventory result), and `payment` (processPayment result)

### Workflow

- name: `"order-fulfillment"`
- mainJob: `fulfillOrder`

## Requirements

- The workflow must be the **default export**
- All 3 jobs (`checkInventory`, `processPayment`, `fulfillOrder`) must be **named exports**

## Reference

Refer to the installed SDK package for workflow and job definition patterns.
