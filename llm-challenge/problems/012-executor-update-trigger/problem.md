# 012: Executor with Update Trigger

## Goal

Create an executor that triggers when an **Order** record's status changes.

## Instructions

An `Order` model is already provided in `tailordb/order.ts` with the following fields:

| Field        | Type   | Required | Notes                                                           |
| ------------ | ------ | -------- | --------------------------------------------------------------- |
| customerName | string | yes      |                                                                 |
| status       | enum   | yes      | Allowed values: `pending`, `processing`, `shipped`, `delivered` |
| totalAmount  | float  | yes      |                                                                 |

The model also includes automatic timestamp fields (`createdAt`, `updatedAt`).

Create the file `executors/orderStatusChanged.ts` with a **default export** that defines an executor.

## Requirements

- **Name**: `"order-status-changed"`
- **Description**: `"Triggered when an order status changes"`
- **Trigger**: Triggered when an Order record is **updated**, with a condition that only fires when the `status` field has changed (i.e., `newRecord.status !== oldRecord.status`)
- **Operation**:
  - Kind: `"function"`
  - Body: An async function that receives `{ newRecord, oldRecord }` and logs the status change using `console.log`
- Import the `order` type from `../tailordb/order`

## Reference

Refer to the installed SDK package for executor and trigger definition patterns.
