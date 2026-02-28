# Problem 006: Fix Broken Order System

## Objective

You are given a broken order system consisting of 3 files: a database model, a resolver, and a workflow. Each file compiles but contains multiple bugs -- naming convention violations, logic errors, missing exports, duplicate values, and more. Your task is to find and fix all the bugs so that the code follows Tailor Platform SDK conventions and passes all tests.

There are **20+ total bugs** spread across the 3 files. None of the files need to be rewritten from scratch; each one is structurally close to correct but has specific issues that need to be addressed.

## Scaffold

You are given:

- `tailor.config.ts` -- App configuration (correct, no bugs)
- `tailordb/orderModel.ts` -- Order model definition (broken)
- `resolvers/calculateOrder.ts` -- Pricing calculator resolver (broken)
- `workflows/orderWorkflow.ts` -- Order fulfillment workflow (broken)

## Types of Bugs to Look For

### Naming Conventions

- Model type names must use **PascalCase** (e.g., `"OrderModel"`, not `"order_model"`)
- Resolver names must use **camelCase** (e.g., `"calculateOrder"`, not `"calculate_order"`)
- Input/output field names must use **camelCase** (e.g., `unitPrice`, not `unit_price`)
- Workflow names must use **kebab-case** (e.g., `"order-fulfillment"`, not `"order_fulfillment"`)
- Job names must use **kebab-case** (e.g., `"process-payment"`, not `"ship_order"`)

### Duplicate Values

- Enum arrays should not contain duplicate entries

### Validation Logic

- "Must be positive" means the value must be **greater than 0**, not greater than or equal to 0

### Calculation Errors

- Verify arithmetic operations match the intended semantics (e.g., total price = quantity times unit price)
- Verify discount rates are expressed as decimals (0.5), not percentages (50)

### Missing Features

- Models should include timestamps (`createdAt`, `updatedAt`)
- Models should include a type export (`export type X = typeof X`)

### Export Issues

- All workflow jobs must be **named exports**
- The workflow itself must be the **default export**

### Uniqueness Constraints

- Each workflow job must have a **unique name** -- no two jobs should share the same name string

### Incomplete Return Values

- Orchestration jobs should return all relevant data from sub-jobs

### Counting Logic

- "Item count" should represent the **total quantity** of items, not the number of distinct line items

## Files to Fix

### 1. `tailordb/orderModel.ts`

A database model for orders with fields for customer info, status, quantity, pricing, and optional discount/notes. It should include a type-level hook that computes `totalPrice` from `quantity` and `unitPrice`.

### 2. `resolvers/calculateOrder.ts`

A resolver that calculates order totals. It accepts a list of items (each with a name, unit price, and quantity), an optional discount code (`"HALF"` for 50% off, `"QUARTER"` for 25% off), and a member tier (`"bronze"`, `"silver"`, `"gold"`) that provides additional discounts (silver: 5%, gold: 10%). The resolver should return subtotal, after-discount amount, final total (clamped to 0), and total item count.

### 3. `workflows/orderWorkflow.ts`

A multi-job workflow for order fulfillment with 4 jobs:

- **validateOrder** -- validates that the order amount is positive
- **processPayment** -- generates a transaction ID
- **shipOrder** -- generates a tracking ID
- **fulfillOrder** (main job) -- orchestrates the above 3 jobs in sequence, short-circuiting on validation failure

## API Reference

```typescript
import { db } from "@tailor-platform/sdk";

// Model with hooks and timestamps
export const myModel = db
  .type("ModelName", {
    field: db.string(),
    ...db.fields.timestamps(),
  })
  .hooks({
    computedField: {
      create: ({ data }) => computedValue,
      update: ({ data }) => computedValue,
    },
  });
export type myModel = typeof myModel;

// Resolver
import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "resolverName",
  description: "...",
  operation: "query",
  input: { fieldName: t.string() },
  body: ({ input }) => ({ result: input.fieldName }),
  output: t.object({ result: t.string() }),
});

// Workflow
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const myJob = createWorkflowJob({
  name: "job-name",
  body: (input: InputType) => output,
});

const result = await otherJob.trigger(args);

export default createWorkflow({
  name: "workflow-name",
  mainJob: mainJobReference,
});
```

## Scoring

| Stage     | Points  |
| --------- | ------- |
| generate  | 15      |
| typecheck | 20      |
| tests     | 90      |
| **Total** | **125** |
