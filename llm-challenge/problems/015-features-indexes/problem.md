# 015: Features and Indexes

## Goal

Create a TailorDB model definition for a **Product** that uses plural form, features, and indexes.

## Instructions

Create the file `tailordb/product.ts` that defines a model with the following specifications:

### Model

- **Name**: `"Product"` with plural form `"Products"` (use `db.type(["Product", "Products"], {...})` syntax)

### Fields

| Field    | Type    | Required | Notes                      |
| -------- | ------- | -------- | -------------------------- |
| name     | string  | yes      | Add field-level `.index()` |
| sku      | string  | yes      | Must be unique             |
| price    | float   | yes      |                            |
| stock    | integer | yes      |                            |
| category | string  | yes      |                            |
| isActive | boolean | yes      |                            |

The model must also include automatic timestamp fields (`createdAt`, `updatedAt`).

### Features

Enable the following features:

- `aggregation: true`
- `bulkUpsert: true`

### Composite Indexes

Add one composite index:

- Fields: `["category", "isActive"]`, name: `"idx_category_active"`

## Requirements

- The file must have a **named export** `product` (the value)
- The file must also export the **type**: `export type product = typeof product;`
- Use `db.type(["Product", "Products"], {...})` for plural form
- Use `.index()` on the `name` field
- Use `.features()` for aggregation and bulkUpsert
- Use `.indexes()` for composite indexes

## Reference

Refer to the installed SDK package for model definition patterns.
