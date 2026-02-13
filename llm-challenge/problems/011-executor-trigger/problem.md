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

Create the file `executors/productCreated.ts` with a **default export** that defines an executor.

## Requirements

- **Name**: `"product-created"`
- **Description**: `"Triggered when a new product is created"`
- **Trigger**: Triggered when a new record of the `product` type is created
- **Operation**:
  - Kind: `"function"`
  - Body: An async function that receives `{ newRecord }` and logs the product name and price using `console.log`
- Import the `product` type from `../tailordb/product`

## Reference

Refer to the installed SDK package for executor definition patterns.
