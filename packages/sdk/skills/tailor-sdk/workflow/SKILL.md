---
name: tailor-sdk/workflow
description: >
  Orchestrate multi-step business logic with createWorkflow and
  createWorkflowJob. Default export for workflow, named exports for
  all jobs. .trigger() for inter-job communication (always await).
  retryPolicy configuration. JSON-serializable input constraints
  (no Date in input). Kysely DB access via getDB() in job bodies.
  Starting workflows from resolvers and CLI.
type: sub-skill
library: tailor-sdk
library_version: "1.25.1"
sources:
  - "tailor-platform/sdk:packages/sdk/docs/services/workflow.md"
  - "tailor-platform/sdk:packages/sdk/src/configure/services/workflow/workflow.ts"
  - "tailor-platform/sdk:packages/sdk/src/configure/services/workflow/job.ts"
  - "tailor-platform/sdk:example/workflows/"
---

This skill builds on tailor-sdk. Read tailor-sdk/SKILL.md first for an overview.

# Workflow

## Setup

One workflow per file. Workflow is default export, all jobs are named exports:

```typescript
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";

export const fetchCustomer = createWorkflowJob({
  name: "fetch-customer",
  body: async (input: { customerId: string }) => {
    const db = getDB("tailordb");
    const customer = await db
      .selectFrom("Customer")
      .selectAll()
      .where("id", "=", input.customerId)
      .executeTakeFirstOrThrow();
    return customer;
  },
});

export const processOrder = createWorkflowJob({
  name: "process-order",
  body: async (input: { orderId: string; customerId: string }) => {
    const customer = await fetchCustomer.trigger({ customerId: input.customerId });
    return { orderId: input.orderId, customerName: customer.name };
  },
});

export default createWorkflow({
  name: "order-processing",
  mainJob: processOrder,
  retryPolicy: {
    maxRetries: 3,
    initialBackoff: "1s",
    maxBackoff: "30s",
    backoffMultiplier: 2,
  },
});
```

## Core Patterns

### Inter-job communication with .trigger()

```typescript
export const validateOrder = createWorkflowJob({
  name: "validate-order",
  body: async (input: { orderId: string }) => {
    const result = await checkInventory.trigger({ orderId: input.orderId });
    if (!result.inStock) {
      return { status: "out-of-stock" };
    }
    const payment = await processPayment.trigger({ orderId: input.orderId });
    return { status: "completed", paymentId: payment.id };
  },
});
```

Jobs execute sequentially on the server — the calling job suspends until the triggered job completes.

### Starting a workflow from CLI

```bash
tailor-sdk workflow start order-processing \
  -m admin-machine-user \
  -a '{"orderId": "abc-123", "customerId": "cust-456"}' \
  --wait
```

### Starting a workflow from a resolver

```typescript
import { createResolver, t } from "@tailor-platform/sdk";
import orderWorkflow from "../workflows/processOrder";
import { auth } from "../tailor.config";

export default createResolver({
  name: "startOrderProcessing",
  operation: "mutation",
  input: { orderId: t.uuid(), customerId: t.uuid() },
  body: async ({ input }) => {
    const runId = await orderWorkflow.trigger(
      { orderId: input.orderId, customerId: input.customerId },
      { authInvoker: auth.invoker("admin-machine-user") },
    );
    return { runId };
  },
  output: t.object({ runId: t.string() }),
});
```

## Common Mistakes

### CRITICAL Not default-exporting createWorkflow result

Wrong:

```typescript
export const myWorkflow = createWorkflow({
  name: "my-workflow",
  mainJob: processOrder,
});
```

Correct:

```typescript
export default createWorkflow({
  name: "my-workflow",
  mainJob: processOrder,
});
```

createWorkflow() result MUST be default exported. The SDK loader will not find the workflow without it.

Source: docs/services/workflow.md

### CRITICAL Not named-exporting workflow jobs

Wrong:

```typescript
const processOrder = createWorkflowJob({ name: "process-order", body: async () => {} });
export default createWorkflow({ name: "order-flow", mainJob: processOrder });
```

Correct:

```typescript
export const processOrder = createWorkflowJob({ name: "process-order", body: async () => {} });
export default createWorkflow({ name: "order-flow", mainJob: processOrder });
```

ALL jobs must be named exports, including mainJob. The SDK uses named exports to discover and register jobs.

Source: docs/services/workflow.md

### HIGH Forgetting to await .trigger()

Wrong:

```typescript
const result = otherJob.trigger({ data: "value" });
// result is Promise<T>, not T
```

Correct:

```typescript
const result = await otherJob.trigger({ data: "value" });
// result is the actual output
```

.trigger() returns a Promise. Without await, you get the Promise object instead of the job's output.

Source: docs/services/workflow.md

### HIGH Using Promise.all for parallel job execution

Wrong:

```typescript
const [a, b] = await Promise.all([jobA.trigger(input), jobB.trigger(input)]);
```

Correct:

```typescript
const a = await jobA.trigger(input);
const b = await jobB.trigger(input);
```

On the server, jobs execute sequentially — the calling job suspends until the triggered job completes. Promise.all does not enable parallel execution and may cause unexpected behavior.

Source: docs/services/workflow.md

### HIGH Using Date in job input

Wrong:

```typescript
createWorkflowJob({
  name: "process",
  body: async (input: { deadline: Date }) => { ... },
});
```

Correct:

```typescript
createWorkflowJob({
  name: "process",
  body: async (input: { deadline: string }) => {
    const deadline = new Date(input.deadline);
    ...
  },
});
```

Job inputs must be JSON-serializable (JsonValue). Date objects are not JsonValue. Use ISO date strings instead. Note: Date is allowed in output (serialized via toJSON).

Source: packages/sdk/src/configure/services/workflow/job.ts

### HIGH Duplicate job names across project

Job names must be globally unique across the entire project, not just within a single file. Duplicate names cause deployment errors.

Source: docs/services/workflow.md

### HIGH Missing authInvoker when triggering workflow from resolver

Wrong:

```typescript
await workflow.trigger({ orderId: input.orderId });
```

Correct:

```typescript
await workflow.trigger(
  { orderId: input.orderId },
  { authInvoker: auth.invoker("admin-machine-user") },
);
```

Triggering workflows from resolvers requires authInvoker. Without it, the call fails at runtime.

Source: example/resolvers/triggerWorkflow.ts

See also: tailor-sdk/resolver/SKILL.md — resolvers commonly trigger workflows
See also: tailor-sdk/code-generation/SKILL.md — workflows use getDB() from generated types
