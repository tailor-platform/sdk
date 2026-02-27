# E-Commerce Data Layer

## Overview

Build a data layer for an e-commerce application using the Tailor Platform SDK. You will define 4 database models that represent the core entities of an online store: customers, products, orders, and order items.

## Requirements

Implement the following 4 model files. Each file must export a named value and a type export.

### 1. Customer (`tailordb/customer.ts`)

Define a `Customer` model with the following fields:

| Field     | Type          | Required | Notes                                                                        |
| --------- | ------------- | -------- | ---------------------------------------------------------------------------- |
| `name`    | string        | Yes      |                                                                              |
| `email`   | string        | Yes      | Must contain `"@"` (add validation)                                          |
| `phone`   | string        | No       |                                                                              |
| `address` | nested object | Yes      | Sub-fields: `street`, `city`, `state`, `zipCode` (all strings, all required) |

- Include timestamps (`createdAt`, `updatedAt`) using `db.fields.timestamps()`
- Named export: `customer`
- Type export: `type customer = typeof customer`
- Type name: `"Customer"`

### 2. Product (`tailordb/product.ts`)

Define a `Product` model with a plural form `"ProductCatalog"`:

| Field          | Type   | Required | Notes                                                                 |
| -------------- | ------ | -------- | --------------------------------------------------------------------- |
| `name`         | string | Yes      |                                                                       |
| `description`  | string | No       |                                                                       |
| `price`        | float  | Yes      | Must be >= 0 (add validation)                                         |
| `sku`          | string | Yes      | Serial field: `start: 1`, `format: "SKU-%04d"`                        |
| `category`     | enum   | Yes      | Values: `"electronics"`, `"clothing"`, `"food"`, `"books"`, `"other"` |
| `inStock`      | bool   | No       |                                                                       |
| `contactEmail` | string | No       |                                                                       |

- Include timestamps
- Add a **type-level hook** on `contactEmail`: the `create` hook should return the lowercased value of `data.contactEmail` (or empty string if falsy)
- Named export: `product`
- Type export: `type product = typeof product`
- Type name tuple: `["Product", "ProductCatalog"]`

### 3. Order (`tailordb/order.ts`)

Define an `Order` model with a plural form `"OrderList"`:

| Field         | Type   | Required | Notes                                                                          |
| ------------- | ------ | -------- | ------------------------------------------------------------------------------ |
| `orderNumber` | string | Yes      | Serial field: `start: 1000`, `format: "ORD-%05d"`                              |
| `customerId`  | uuid   | Yes      | Relation: `n-1` toward `Customer` (import from `./customer`)                   |
| `status`      | enum   | Yes      | Values: `"pending"`, `"processing"`, `"shipped"`, `"delivered"`, `"cancelled"` |
| `totalAmount` | float  | No       |                                                                                |
| `notes`       | string | No       |                                                                                |

- Include timestamps
- Named export: `order`
- Type export: `type order = typeof order`
- Type name tuple: `["Order", "OrderList"]`

### 4. OrderItem (`tailordb/orderItem.ts`)

Define an `OrderItem` model:

| Field       | Type  | Required | Notes                                                      |
| ----------- | ----- | -------- | ---------------------------------------------------------- |
| `orderId`   | uuid  | Yes      | Relation: `n-1` toward `Order` (import from `./order`)     |
| `productId` | uuid  | Yes      | Relation: `n-1` toward `Product` (import from `./product`) |
| `quantity`  | int   | Yes      | Must be > 0 (add validation)                               |
| `unitPrice` | float | Yes      | Must be >= 0 (add validation)                              |
| `lineTotal` | float | Yes      |                                                            |

- Include timestamps
- Add a **type-level hook** on `lineTotal`: the `create` hook should compute `quantity * unitPrice` from the record data (default to 0 if either is missing)
- Named export: `orderItem`
- Type export: `type orderItem = typeof orderItem`
- Type name: `"OrderItem"`

## Scaffold

A `tailor.config.ts` and a partial `tailordb/customer.ts` are provided as starting points.
