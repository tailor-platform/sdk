# Problem 002: Resolver Pipeline with Business Logic

## Objective

Implement three resolvers that demonstrate different patterns: complex business logic with discounts, database querying with optional filters, and role-based access control with discriminated union returns.

## Scaffold

You are given:

- `tailor.config.ts` — App configuration with DB, resolver declarations, and Kysely type generator
- `tailordb/inventory.ts` — Inventory model definition

## Files to Implement

### 1. `resolvers/pricingCalculator.ts` (mutation)

A pricing calculator that takes a list of line items, applies a coupon discount, then applies a member rank discount.

**Input:**

- `items`: array of objects with `{ name: t.string(), unitPrice: t.float(), quantity: t.int() }`
- `couponCode`: optional string — if `"SAVE10"` → 10% off, if `"SAVE20"` → 20% off, otherwise 0%
- `memberRank`: optional enum `["bronze", "silver", "gold", "platinum"]`

**Business Logic:**

1. Calculate `subtotal`: sum of `(unitPrice * quantity)` for each item
2. Apply coupon discount: `discountedSubtotal = subtotal * (1 - couponRate)`
3. Apply member rank discount: bronze=0%, silver=5%, gold=10%, platinum=15%. Default (no rank) = 0%
4. `finalTotal = discountedSubtotal * (1 - rankRate)`
5. Clamp `finalTotal` to 0 if negative: `Math.max(0, finalTotal)`
6. `itemCount` = sum of all quantities
7. If items array is empty, return all zeros

**Output:** `{ subtotal: float, discountedSubtotal: float, finalTotal: float, itemCount: int }`

### 2. `resolvers/lookupInventory/resolver.ts` (query)

Uses `getDB` to query the Inventory table with optional filtering.

**Input:**

- `category`: optional string — filter by category if provided
- `minStock`: optional int — filter where `stock >= minStock` if provided

**Body (async):**
Build a Kysely query on the `"Inventory"` table, conditionally adding `.where()` clauses based on which inputs are provided. Select columns: `id`, `name`, `category`, `stock`, `price`. Return `{ items: results, count: results.length }`.

Import `getDB` from `"../../generated/tailordb"`.

**Output:** `{ items: array of { id: string, name: string, category: string, stock: int, price: float }, count: int }`

### 3. `resolvers/auditAction.ts` (mutation)

A mutation that checks user role and performs audit logging.

**Input:**

- `action`: string (required)
- `targetId`: string (required)
- `reason`: optional string

**Body:**

- Check `user.attributes?.role`. If role is not `"admin"` and not `"auditor"`, return `{ success: false, message: "Access denied: role '<role>' is not authorized" }` (use `"unknown"` if role is undefined).
- Otherwise, return `{ success: true, message: "Audit logged: <action> on <targetId> by <userId>", auditEntry: { userId, action, targetId, reason (default "No reason provided"), timestamp (ISO string) } }`.

**Output:** `{ success: bool, message: string, auditEntry?: { userId: string, action: string, targetId: string, reason: string, timestamp: string } }`

## Scoring

| Stage     | Points  |
| --------- | ------- |
| generate  | 20      |
| typecheck | 25      |
| tests     | 155     |
| **Total** | **200** |
