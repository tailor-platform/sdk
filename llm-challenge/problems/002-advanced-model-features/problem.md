# 002: Advanced Model Features

## Goal

Build data models for an **e-commerce and publishing platform** that exercises advanced TailorDB features: relations, serial fields, hooks, indexes, features, and permissions.

An `Author` model is already provided in `tailordb/author.ts`. You need to create three models that demonstrate different advanced capabilities.

## Domain Context

- **Books** are published by authors and identified by unique ISBN numbers.
- **Invoices** require auto-incrementing identifiers and automatic email normalization on every write.
- **Products** in the catalog need efficient querying (indexes), bulk operations, and access control rules.

## What to Build

### 1. `tailordb/book.ts` - Book Model

A book record related to the provided Author model:

- `title` (string, required)
- `isbn` (string, required, unique)
- `price` (integer, optional)
- `authorID` (uuid, required) - n-1 relation to Author model
- Automatic timestamps

### 2. `tailordb/invoice.ts` - Invoice Model

An invoice with auto-incrementing serial numbers and email normalization hooks:

- `invoiceNumber` (string) - serial with `start: 1` and `format: "INV-{:05d}"`
- `sequenceId` (integer) - serial with `start: 1000` and `maxValue: 99999`
- `customerEmail` (string, required)
- `amount` (float, required)
- `status` (enum, required) - allowed values: `draft`, `sent`, `paid`, `overdue`
- Automatic timestamps

The model must have **hooks** on `customerEmail`:

- On **create**: lowercase the value (if null, return empty string `""`)
- On **update**: lowercase the value (if null, return empty string `""`)

### 3. `tailordb/product.ts` - Product Model

A product with plural form, indexes, features, and permissions:

- Plural form: `"Products"`
- `name` (string, required) - with field-level index
- `sku` (string, required, unique)
- `price` (float, required)
- `stock` (integer, required)
- `category` (string, required)
- `isActive` (boolean, required)
- Automatic timestamps

Advanced features:

- **Features**: enable `aggregation` and `bulkUpsert`
- **Composite index**: named `"idx_category_active"` on fields `["category", "isActive"]`
- **Record-level permissions**:
  - create: 1 rule - permit when user is logged in (`{ user: "_loggedIn" }` equals `true`)
  - read: 2 rules - permit when `record.isPublic` is `true`, OR when `record.ownerId` equals `user.id`
  - update: 1 rule - permit when `newRecord.ownerId` equals `user.id`
  - delete: 1 rule - permit when `record.ownerId` equals `user.id`
- **GQL permissions**: 2 policies
  - First: permit `["read", "create"]` when user is logged in
  - Second: permit `"all"` with empty conditions

Note: The product model needs `ownerId` (uuid) and `isPublic` (boolean) fields to support the permission rules.

## Requirements

- Each file must have a **named export** matching the model name in camelCase
- Each file must also export the **type**: `export type modelName = typeof modelName;`
- Import `author` from `./author` for the Book relation

## Reference

Refer to the installed SDK package for model definition patterns including relations, serial fields, hooks, indexes, features, and permissions.
