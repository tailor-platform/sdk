# 011: Executor Trigger

## Goal

Create an executor that triggers when a new **Product** record is created and logs the product information.

## Instructions

A `Product` model is already provided in `tailordb/product.ts` with the following fields:

| Field   | Type    | Required | Notes |
| ------- | ------- | -------- | ----- |
| name    | string  | yes      |       |
| price   | integer | yes      |       |
| inStock | boolean | yes      |       |

The model also includes automatic timestamp fields (`createdAt`, `updatedAt`).

Create the file `executors/productCreated.ts` with a **default export** using `createExecutor`.

## Requirements

- **Name**: `"product-created"`
- **Description**: `"Triggered when a new product is created"`
- **Trigger**: Use `recordCreatedTrigger` targeting the `product` type
- **Operation**:
  - Kind: `"function"`
  - Body: An async function that receives `{ newRecord }` and logs the product name and price using `console.log`
- Import `createExecutor` and `recordCreatedTrigger` from `@tailor-platform/sdk`
- Import `product` from `../tailordb/product`

## Example

Refer to the SDK documentation for executor definition patterns using `createExecutor()` and `recordCreatedTrigger()`.
