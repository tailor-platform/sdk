# Problem 004: Multi-Job Workflow with Data Flow

## Objective

Build a data processing pipeline workflow using the Tailor Platform SDK. The pipeline consists of 5 jobs across 4 files that validate input, enrich data, process a payment, send a confirmation, and orchestrate the entire flow. This tests your understanding of multi-job workflows, inter-job communication via `.trigger()`, and proper export conventions.

## Scaffold

You are given:

- `tailor.config.ts` -- App configuration with workflow file declarations

## Files to Implement

### 1. `workflows/validateInput.ts`

A validation job that checks all input fields and accumulates errors (does not short-circuit on the first error).

**Named export:** `validateInput`

**Input:**

- `email`: string
- `amount`: number
- `items`: array of `{ name: string; price: number }`

**Validation rules (check all, collect all errors):**

1. `email` must contain `"@"` -- error message: `"Invalid email: must contain @"`
2. `amount` must be greater than 0 (not >= 0, strictly > 0) -- error message: `"Invalid amount: must be greater than 0"`
3. `items` must not be empty -- error message: `"Invalid items: must not be empty"`

**Output:** `{ valid: boolean; errors: string[] }`

- `valid` is `true` only if there are no errors
- `errors` contains all collected error messages

**Job name:** `"validate-input"`

### 2. `workflows/enrichData.ts`

An enrichment job that computes derived fields from the input data.

**Named export:** `enrichData`

**Input:**

- `email`: string
- `amount`: number
- `items`: array of `{ name: string; price: number }`

**Business logic:**

1. `itemCount` = number of items
2. `averagePrice` = sum of item prices / item count (0 if no items)
3. `priority` based on amount:
   - `"high"` if amount >= 1000
   - `"medium"` if amount >= 100 (and < 1000)
   - `"low"` if amount < 100

**Output:** `{ email: string; amount: number; itemCount: number; averagePrice: number; priority: "low" | "medium" | "high"; items: { name: string; price: number }[] }`

**Job name:** `"enrich-data"`

### 3. `workflows/processPayment.ts`

A payment processing job that generates a transaction ID.

**Named export:** `processPayment`

**Input:**

- `email`: string
- `amount`: number
- `priority`: string

**Business logic:**

- Generate `transactionId` as `` `txn-${amount}-${priority}` ``

**Output:** `{ transactionId: string; status: "completed"; amount: number }`

**Job name:** `"process-payment"`

### 4. `workflows/orchestrate.ts`

The orchestration file contains two jobs and the workflow definition. It also re-exports all jobs from the other files.

#### sendConfirmation job

**Named export:** `sendConfirmation`

**Input:** `{ email: string; transactionId: string; amount: number }`

**Output:** `{ sent: true; recipient: string; transactionId: string }`

**Job name:** `"send-confirmation"`

#### orchestrate job (main job)

**Named export:** `orchestrate`

**Input:**

- `email`: string
- `amount`: number
- `items`: array of `{ name: string; price: number }`

**Pipeline steps (use `.trigger()` to call each job):**

1. **Validate** -- trigger `validateInput` with the input. If `valid` is `false`, return early with `{ success: false, errors }`.
2. **Enrich** -- trigger `enrichData` with the input.
3. **Process payment** -- trigger `processPayment` with email, amount, and priority from the enriched data.
4. **Send confirmation** -- trigger `sendConfirmation` with email, transactionId, and amount from the payment result.

**Output on success:**

```typescript
{
  success: true,
  enriched: { itemCount, averagePrice, priority },
  payment: { transactionId, status },
  confirmation: { sent, recipient },
}
```

**Output on validation failure:**

```typescript
{
  success: false,
  errors: string[],
}
```

**Job name:** `"orchestrate-pipeline"`

#### Workflow definition

**Default export:** the workflow created with `createWorkflow`

**Workflow name:** `"order-pipeline"`

**Main job:** `orchestrate`

#### Re-exports

The orchestrate file must re-export all jobs from the other files as named exports:

- `validateInput` from `./validateInput`
- `enrichData` from `./enrichData`
- `processPayment` from `./processPayment`

This ensures the workflow engine can discover all jobs from a single entry point.

## Key Requirements

- Each job must have a **unique name** across the entire project
- All jobs must be **named exports**
- The workflow must be the **default export** of `orchestrate.ts`
- The `orchestrate` job body must be `async` since `.trigger()` returns a `Promise`
- Validation must accumulate all errors (no early return on first error)
- The orchestrator must short-circuit on validation failure (do not call enrich/payment/confirmation if validation fails)

## API Reference

```typescript
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

// Define a job
export const myJob = createWorkflowJob({
  name: "unique-job-name",
  body: (input: InputType) => {
    return output;
  },
});

// Trigger another job (returns a Promise)
const result = await otherJob.trigger(args);

// Define the workflow (MUST be default export)
export default createWorkflow({
  name: "workflow-name",
  mainJob: mainJobReference,
});

// All jobs MUST be named exports
export { job1, job2 };
```

## Scoring

| Stage     | Points  |
| --------- | ------- |
| generate  | 15      |
| typecheck | 20      |
| tests     | 140     |
| **Total** | **175** |
