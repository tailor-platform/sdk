---
name: tailor-sdk-workflow
description: Use this skill when creating or modifying workflows and workflow jobs in @tailor-platform/sdk projects. Covers createWorkflow, createWorkflowJob, job triggers, JSON serialization constraints, and cross-service integration.
metadata:
  sources:
    - docs/services/workflow.md
---

# Workflow Service

Workflows orchestrate multi-step business logic using `createWorkflow` and `createWorkflowJob` from `@tailor-platform/sdk`.

## Setup

```typescript
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
```

Workflow files live under a `workflows/` directory in the project root (alongside `tailordb/`, `resolvers/`, etc.). Each file defines one workflow as a default export and all its jobs as named exports.

## Core Patterns

### Basic Workflow

```typescript
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const validateOrder = createWorkflowJob({
  name: "validate-order",
  body: async (input: { orderId: string }) => {
    // business logic here
    return { valid: true };
  },
});

export const processPayment = createWorkflowJob({
  name: "process-payment",
  body: async (input: { orderId: string }) => {
    const validation = await validateOrder.trigger({ orderId: input.orderId });
    return { paid: true };
  },
});

export default createWorkflow({
  name: "order-workflow",
  mainJob: processPayment,
});
```

### Export Rules (CRITICAL)

1. `createWorkflow()` result **must** be the default export of the file.
2. Every job — including the mainJob and any job called via `.trigger()` — **must** be a named export.
3. Job names must be globally unique across the entire project, not just within a single file.

Violating any of these rules causes silent deployment failures or runtime errors.

### Triggering Jobs

`.trigger()` returns a `Promise<T>`. Always `await` it:

```typescript
const result = await someJob.trigger({ key: "value" });
```

On the server, the calling job suspends until the triggered job completes. Execution is synchronous despite the Promise-based API. This means `Promise.all()` does **not** run jobs in parallel — they still execute serially.

### Jobs in Separate Files

Jobs can be defined in their own files and imported into the workflow file. Each job file must still use named exports:

```typescript
// workflows/jobs/validate.ts
import { createWorkflowJob } from "@tailor-platform/sdk";

export const validateOrder = createWorkflowJob({
  name: "validate-order",
  body: async (input: { orderId: string }) => {
    return { valid: true };
  },
});
```

```typescript
// workflows/order.ts
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { validateOrder } from "./jobs/validate";

export { validateOrder };

export const processOrder = createWorkflowJob({
  name: "process-order",
  body: async (input: { orderId: string }) => {
    const result = await validateOrder.trigger({ orderId: input.orderId });
    return { processed: true };
  },
});

export default createWorkflow({
  name: "order-workflow",
  mainJob: processOrder,
});
```

Note: re-export imported jobs from the workflow file so they are named exports of the module.

### Environment Variables

The job body receives an optional second parameter with `env`:

```typescript
export const myJob = createWorkflowJob({
  name: "my-job",
  body: async (input: { id: string }, { env }) => {
    const apiKey = env.MY_API_KEY;
    // use apiKey
    return { success: true };
  },
});
```

### Triggering Workflows from Resolvers

Use `workflow.trigger()` with `authInvoker` for machine user permissions:

```typescript
import { createResolver, t } from "@tailor-platform/sdk";
import orderWorkflow from "../workflows/order";
import { auth } from "../auth";

export default createResolver({
  name: "start-order",
  operation: "mutation",
  input: {
    orderId: t.string(),
  },
  body: async ({ input }) => {
    const workflowRunId = await orderWorkflow.trigger(
      { orderId: input.orderId },
      { authInvoker: auth.invoker("machine-user") },
    );
    return { workflowRunId };
  },
  output: t.object({
    workflowRunId: t.string(),
  }),
});
```

`authInvoker` requires a machine user defined in `defineAuth`. See the `tailor-sdk-auth` skill for machine user configuration.

## JSON Serialization Constraints

### Input (strict)

Job inputs must be JSON-compatible. The following types are **not** allowed and will produce a compile-time `never` type:

- `Date`
- `Map`
- `Set`
- Functions
- `undefined` (use `null` instead)
- Class instances without `toJSON()`

### Output (permissive)

Job outputs allow:

- `Date` objects (serialized via `toJSON()`)
- Objects with a `toJSON()` method

### Trigger Return Type

The return value of `.trigger()` is `Jsonify<Output>`, not `Output` directly. This means:

- `Date` in the output becomes `string` in the trigger return
- Nested `Date` fields also become `string`

```typescript
// Job returns { createdAt: Date }
// trigger() returns { createdAt: string }
const result = await myJob.trigger({ id: "123" });
// result.createdAt is a string, not a Date
```

## Common Mistakes

### CRITICAL: Missing default export on workflow

```typescript
// WRONG — workflow is not exported as default
export const myWorkflow = createWorkflow({
  name: "my-workflow",
  mainJob: myJob,
});

// CORRECT
export default createWorkflow({
  name: "my-workflow",
  mainJob: myJob,
});
```

### CRITICAL: Missing named export on job

```typescript
// WRONG — job is not a named export
const myJob = createWorkflowJob({
  name: "my-job",
  body: async (input: {}) => ({ done: true }),
});

// CORRECT
export const myJob = createWorkflowJob({
  name: "my-job",
  body: async (input: {}) => ({ done: true }),
});
```

### CRITICAL: Duplicate job names across files

```typescript
// workflows/a.ts
export const process = createWorkflowJob({ name: "process", ... });

// workflows/b.ts
export const process = createWorkflowJob({ name: "process", ... });
// ERROR — "process" is used in both files. Job names must be globally unique.
```

### HIGH: Using Promise.all() for parallel execution

```typescript
// WRONG — jobs still run serially, not in parallel
const [a, b] = await Promise.all([jobA.trigger({ id: "1" }), jobB.trigger({ id: "2" })]);

// This is functionally identical to sequential awaits:
const a = await jobA.trigger({ id: "1" });
const b = await jobB.trigger({ id: "2" });
```

### HIGH: Non-JSON-compatible input types

```typescript
// WRONG — Date is not JSON-compatible for input
export const myJob = createWorkflowJob({
  name: "my-job",
  body: async (input: { date: Date }) => {
    // compile-time error (never)
    return {};
  },
});

// CORRECT — use string for dates in input
export const myJob = createWorkflowJob({
  name: "my-job",
  body: async (input: { date: string }) => {
    const parsed = new Date(input.date);
    return {};
  },
});
```

### MEDIUM: Expecting Date objects from trigger return

```typescript
// The job returns a Date...
export const myJob = createWorkflowJob({
  name: "my-job",
  body: async (input: {}) => {
    return { createdAt: new Date() };
  },
});

// ...but trigger() returns Jsonify<Output>, so createdAt is a string
const result = await myJob.trigger({});
// result.createdAt is string, not Date — parse it if needed
const date = new Date(result.createdAt);
```

## Cross-References

- **tailor-sdk-auth** — `authInvoker` requires a machine user from `defineAuth`
- **tailor-sdk-resolver** — resolvers can trigger workflows using `workflow.trigger()`
