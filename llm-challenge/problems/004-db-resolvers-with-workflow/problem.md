# 004: Database Resolvers with Workflow Integration

## Goal

Build the resolver layer for an order management system. The system needs database access for user lookups, complex order processing with discount calculations, and workflow triggering for async data processing.

## Requirements

Create the following 3 resolver files, each with a **default export** using `createResolver`:

### 1. `resolvers/getUser.ts` — User Lookup

A **query** resolver named `"getUser"` that fetches a user from the database.

- **Input**: `id` (string)
- **Body**: Uses `getDB("tailordb")` to query the `"User"` table by `id`, selecting `name` and `email`. Use Kysely's `.selectFrom("User")`, `.select(["name", "email"])`, `.where("id", "=", input.id)`, and `.executeTakeFirstOrThrow()`.
- **Output**: object with `name` (string) and `email` (string)

Import `getDB` from `"../generated/tailordb"`.

### 2. `resolvers/processOrder.ts` — Order Processing

A **mutation** resolver named `"processOrder"` that processes an order with discount calculation.

- **Input**:
  - `customer` — object with `name` (string) and `email` (string)
  - `items` — array of objects with `productName` (string), `quantity` (integer), `unitPrice` (float)
  - `discountType` — enum: `"none"`, `"percentage"`, `"fixed"`
  - `discountValue` — float (optional)
- **Body logic**:
  1. Compute `subtotal` as sum of (quantity \* unitPrice) for all items
  2. Apply discount: `"none"` = no discount, `"percentage"` = subtract (subtotal \* discountValue / 100), `"fixed"` = subtract discountValue
  3. `total` = final amount after discount (minimum 0)
  4. `itemCount` = sum of all quantities
  5. Return `{ customerName: customer.name, subtotal, total, itemCount }`
- **Output**: object with `customerName` (string), `subtotal` (float), `total` (float), `itemCount` (integer)

### 3. `resolvers/startProcessing/resolver.ts` — Workflow Trigger

A **mutation** resolver named `"startProcessing"` that triggers a workflow job.

- **Input**: `dataId` (string), `priority` (enum: `"low"`, `"medium"`, `"high"`)
- **Body**: Import `processDataJob` from the provided workflow file and call `.trigger()` with the input values. Do NOT use `await` — `.trigger()` is synchronous on server. Return `{ triggered: true, result }`.
- **Output**: object with `triggered` (boolean) and `result` (optional object)

Import `processDataJob` from `"../../workflows/dataProcessing"`.

## Scaffold

- `tailor.config.ts` — Configuration with tailordb, resolver, and workflow file globs, plus `@tailor-platform/kysely-type` generator
- `tailordb/user.ts` — User model with `name` and `email` fields
- `workflows/dataProcessing.ts` — Workflow with a `processDataJob` job

## Reference

Refer to the installed SDK package for resolver definition, Kysely query builder, and workflow trigger patterns.
