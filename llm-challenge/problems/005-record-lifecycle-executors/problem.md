# 005: Record Lifecycle Executors

## Goal

Build a set of executors that respond to the complete lifecycle of records and resolver execution events in an order management system.

## Domain Context

The system manages products, orders, and tasks. Various automated actions should fire when:

- A new product is added to the catalog
- An order's status changes (but not when other fields are updated)
- A task is removed from the system
- A product lookup resolver completes (for audit logging)

Three models (`product`, `order`, `task`) and one resolver (`getProduct`) are already provided as scaffold.

## What to Build

### 1. `executors/productCreated.ts` - New Product Handler

An executor that fires when a new Product record is created.

- **Name**: `"product-created"`
- **Description**: A non-empty string describing the executor
- **Trigger**: Fires on new record creation for the `product` type
- **Operation**: A function that receives `{ newRecord }` and logs the product name and price via `console.log`
- Import `product` from `../tailordb/product`

### 2. `executors/orderStatusChanged.ts` - Order Status Change Handler

An executor that fires only when an order's status field changes (not on other field updates).

- **Name**: `"order-status-changed"`
- **Description**: A non-empty string describing the executor
- **Trigger**: Fires on record update for the `order` type, with a **condition** that checks `newRecord.status !== oldRecord.status`
- **Operation**: A function that receives `{ newRecord, oldRecord }` and logs the status transition via `console.log`
- Import `order` from `../tailordb/order`

### 3. `executors/taskDeleted.ts` - Task Deletion Handler

An executor that fires when a Task record is deleted.

- **Name**: `"task-deleted"`
- **Description**: A non-empty string describing the executor
- **Trigger**: Fires on record deletion for the `task` type
- **Operation**: A function that receives `{ oldRecord }` and logs the deleted task title via `console.log`
- Import `task` from `../tailordb/task`

### 4. `executors/logResolverExecution.ts` - Resolver Audit Logger

An executor that fires after the `getProduct` resolver executes, logging whether it succeeded or failed.

- **Name**: `"log-resolver-execution"`
- **Description**: A non-empty string describing the executor
- **Trigger**: Fires when the `getProduct` resolver is executed (use `resolverExecutedTrigger`)
- **Operation**: A function that checks `args.success` - if true, logs the result; if false, logs the error
- Import the `getProduct` resolver from `../resolvers/getProduct/resolver`

## Requirements

- Each file must have a **default export** using `createExecutor`
- All operations are of kind `"function"` with async body functions

## Reference

Refer to the installed SDK package for executor definition patterns and trigger types.
