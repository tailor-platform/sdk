# Workflow

Workflows orchestrate multiple jobs that can depend on each other, enabling complex multi-step operations with durable execution.

## Overview

Workflows provide:

- Job orchestration with dependencies
- Durable execution with automatic state management
- Resume capabilities from failure points
- Access to TailorDB via Kysely query builder
- Job triggering to compose multi-step logic

For the official Tailor Platform documentation, see [Workflow Guide](https://docs.tailor.tech/guides/workflow).

## Workflow Rules

All workflow components must follow these rules:

**Definition Rules:**

- **One workflow + multiple jobs per file**: Each file can define multiple jobs (named exports) and one workflow (default export)
- **Workflow export method**: Must use `export default`
- **Job export method**: Must use named exports (`export const`)
- **Job name uniqueness**: Job names must be unique across the entire project (not just within one file)
- **mainJob required**: Every workflow must specify a `mainJob`

| Rule                                           | Description                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `createWorkflow` result must be default export | Workflow files must export the workflow as default                                                       |
| All jobs must be named exports                 | Includes `mainJob` and any job triggered via `.trigger()` (even if referenced only within the same file) |
| Job `name` values must be unique               | Job names must be unique across the entire project                                                       |
| `mainJob` is required                          | Every workflow must specify a `mainJob`                                                                  |

## Creating a Workflow Job

Define workflow jobs using `createWorkflowJob`:

```typescript
import { createWorkflowJob } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";

// All jobs must be named exports
export const fetchCustomer = createWorkflowJob({
  name: "fetch-customer",
  body: async (input: { customerId: string }) => {
    const db = getDB("tailordb");
    const customer = await db
      .selectFrom("Customer")
      .selectAll()
      .where("id", "=", input.customerId)
      .executeTakeFirst();
    return customer;
  },
});
```

## Input and Output Type Constraints

Workflow job inputs and outputs are serialized as JSON when passed between jobs. This imposes type constraints:

**Input types** must be JSON-compatible — primitives (`string`, `number`, `boolean`), arrays, and plain objects are allowed. `Date`, `Map`, `Set`, functions, and other non-serializable types cannot be used. Top-level `null` is also rejected because the platform normalizes top-level `null`/`undefined` args to `{}` (nested `null` inside objects or arrays is preserved).

```typescript
// OK
export const myJob = createWorkflowJob({
  name: "my-job",
  body: async (input: { id: string; count: number; tags: string[] }) => {
    // ...
  },
});

// Compile error — Date is not allowed in input
export const badJob = createWorkflowJob({
  name: "bad-job",
  body: async (input: { createdAt: Date }) => {
    // ...
  },
});

// Compile error — top-level null would be normalized to {} by the platform
export const nullJob = createWorkflowJob({
  name: "null-job",
  body: async (input: { id: string } | null) => {
    // ...
  },
});
```

**Output types** have the same restriction as inputs: must be JsonValue-compatible (plain objects/arrays; no class instances or functions). Values with methods (function-typed properties) are rejected at compile time — this covers class instances like `Date` or `RegExp` as well as any plain object that exposes a method such as `toJSON()`.

These constraints are enforced at compile time — you will get a type error if you use an unsupported type.

## Triggering Jobs

Use `.trigger()` to start other jobs from within a job.

Jobs are triggered by calling `.trigger()` on the other job object (no `deps` and no `jobs` object in the context).

```typescript
import { createWorkflowJob } from "@tailor-platform/sdk";
import { fetchCustomer } from "./jobs/fetch-customer";
import { sendNotification } from "./jobs/send-notification";

export const mainJob = createWorkflowJob({
  name: "main-job",
  body: async (input: { customerId: string }) => {
    // You can write `await` for type-safety in your source.
    // During deployment bundling, job.trigger() calls are transformed to a synchronous
    // runtime call and `await` is removed.
    const customer = await fetchCustomer.trigger({
      customerId: input.customerId,
    });
    const notification = await sendNotification.trigger({
      message: "Order processed",
      recipient: customer.email,
    });
    return { customer, notification };
  },
});
```

**Important:** On the Tailor runtime, job triggers are executed synchronously. This means `Promise.all([jobA.trigger(), jobB.trigger()])` will not run jobs in parallel.

### Deterministic Execution Requirement

Workflow jobs use a **suspend/resume execution model**. When a job calls `.trigger()`, the runtime suspends the current job, executes the triggered job, and then **re-executes the calling job from the beginning** with cached results from previous triggers.

This means that **job code must be deterministic** — every re-execution must produce the same sequence of `.trigger()` calls with the same arguments in the same order.

Using `.trigger()` inside a loop works correctly, as long as the loop is deterministic:

```typescript
// ✅ OK: deterministic loop — same calls in the same order on every execution
const regions = ["us", "eu", "ap"];
for (const region of regions) {
  const result = await fetchData.trigger({ region });
  results.push(result);
}
```

```typescript
// ❌ Bad: non-deterministic — argument changes between executions
await processJob.trigger({ timestamp: Date.now() });

// ✅ OK: call Date.now() in separated job
const timestamp = await timestampJob.trigger();
await processJob.trigger({ timestamp });
```

```typescript
// ❌ Bad: non-deterministic — external data may change between executions
const items = await fetch("https://api.example.com/items").then((r) => r.json());
for (const item of items) {
  await processItem.trigger({ id: item.id });
}

// ✅ OK: call fetch("https://api.example.com/items").then((r) => r.json()); in separated job
const items = await fetchItemsJob.trigger();
for (const item of items) {
  await processItem.trigger({ id: item.id });
}
```

If the runtime detects that a `.trigger()` call at the same position has different arguments than the previous execution, it will throw an **argument hash mismatch error**.

**Guidelines:**

- Do not use non-deterministic values (random numbers, timestamps, external API responses) as `.trigger()` arguments.
- Do not use conditions that may change between executions to decide whether to call `.trigger()`.
- Any data that varies between executions should be fetched **inside the triggered job**, not passed as an argument from the calling job.

## Workflow Definition

Define a workflow using `createWorkflow` and export it as default:

```typescript
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { fetchCustomer } from "./jobs/fetch-customer";
import { sendNotification } from "./jobs/send-notification";

// Jobs must be named exports
export const processOrder = createWorkflowJob({
  name: "process-order",
  body: async (input: { customerId: string }, { env, invoker }) => {
    // `env` contains values from `tailor.config.ts` -> `env`.
    // `invoker` is the principal running this job, overridden by `authInvoker`
    // when set; `null` for anonymous calls.
    // Trigger other jobs by calling .trigger() on the job object.
    const customer = await fetchCustomer.trigger({
      customerId: input.customerId,
    });
    await sendNotification.trigger({
      message: "Order processed",
      recipient: customer.email,
    });
    return { customerId: input.customerId };
  },
});

// Workflow must be default export
export default createWorkflow({
  name: "order-processing",
  mainJob: processOrder,
});
```

## Wait Points

Wait points allow a workflow job to suspend execution and wait for an external signal before resuming. This enables human-in-the-loop patterns such as approvals, reviews, and manual confirmations.

### Defining Wait Points

Use `defineWaitPoint` to declare a single typed wait point:

```typescript
import { defineWaitPoint } from "@tailor-platform/sdk";

export const approval = defineWaitPoint<
  { message: string; requestId: string },
  { approved: boolean }
>("approval");
```

For multiple wait points, use `defineWaitPoints` with a builder callback. Property names become wait point keys, and JSDoc on each property is preserved in IDE autocompletion:

```typescript
import { defineWaitPoints } from "@tailor-platform/sdk";

export const waitPoints = defineWaitPoints((define) => ({
  /** Manager approval step */
  managerApproval: define<{ amount: number }, { approved: boolean }>(),
  /** Finance review step */
  financeReview: define<{ invoiceId: string }, { validated: boolean }>(),
}));

await waitPoints.managerApproval.wait({ amount: 50000 });
```

Both accept two type parameters:

- **`Payload`** — Data sent when the job suspends (passed to `.wait()`). Must be a pure JSON value (`string`, `number`, `boolean`, `null`, arrays, plain objects). Use `undefined` if no payload is needed.
- **`Result`** — Data returned when the wait point is resolved (returned from `.wait()`, produced by the `.resolve()` callback). Must be a pure JSON value.

Both must be JsonValue-compatible (plain objects/arrays; no class instances or functions). Values with methods (function-typed properties) are rejected at compile time — this covers class instances like `Date` or `RegExp` as well as any plain object that exposes a method such as `toJSON()`. Convert such values to `string` (e.g. ISO strings) or `number` (epoch millis) before passing them through a wait point.

### Waiting in a Job

Call `.wait()` inside a workflow job body to suspend execution:

```typescript
import { createWorkflow, createWorkflowJob, defineWaitPoint } from "@tailor-platform/sdk";

export const approval = defineWaitPoint<
  { message: string; requestId: string },
  { approved: boolean }
>("approval");

export const processWithApproval = createWorkflowJob({
  name: "process-with-approval",
  body: async (input: { orderId: string }) => {
    // Suspends here until resolved externally
    const result = await approval.wait({
      message: `Please approve order ${input.orderId}`,
      requestId: input.orderId,
    });

    if (!result.approved) {
      return { orderId: input.orderId, status: "rejected" as const };
    }
    return { orderId: input.orderId, status: "approved" as const };
  },
});

export default createWorkflow({
  name: "approval-workflow",
  mainJob: processWithApproval,
});
```

### Resolving from a Resolver

Call `.resolve()` from a resolver (or executor) to resume a suspended job. The callback receives the payload that was passed to `.wait()` and returns the result:

```typescript
import { createResolver, t } from "@tailor-platform/sdk";
import { approval } from "../workflows/approval";

export default createResolver({
  name: "resolveApproval",
  description: "Resolve a waiting approval",
  operation: "mutation",
  input: {
    executionId: t.string(),
    approved: t.bool(),
  },
  body: async ({ input }) => {
    await approval.resolve(input.executionId, (payload) => {
      console.log("Resolving:", payload.message);
      return { approved: input.approved };
    });
    return { resolved: true };
  },
  output: t.object({
    resolved: t.bool(),
  }),
});
```

Wait points can be imported and used in any file (workflow jobs, resolvers, executors). For local testing, see [Jobs that wait on approval](../testing.md#jobs-that-wait-on-approval) in the testing guide.

## Retry Policy

You can configure automatic retry behavior with exponential backoff by setting `retryPolicy` on a workflow. All fields are required when `retryPolicy` is set:

| Field               | Type     | Description                                                |
| ------------------- | -------- | ---------------------------------------------------------- |
| `maxRetries`        | `number` | Maximum number of retries (1–10)                           |
| `initialBackoff`    | `string` | Initial backoff duration (e.g., `"1s"`, `"500ms"`, max 1h) |
| `maxBackoff`        | `string` | Maximum backoff duration (e.g., `"30s"`, `"5m"`, max 24h)  |
| `backoffMultiplier` | `number` | Backoff multiplier for exponential backoff (>= 1)          |

Duration strings support `ms`, `s`, and `m` units. `initialBackoff` must be less than or equal to `maxBackoff`.

```typescript
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

## Concurrency Policy

You can limit the number of concurrent executions of a workflow by setting `concurrencyPolicy`. When the limit is reached, new executions remain in PENDING state until a running execution completes.

| Field                     | Type     | Description                                      |
| ------------------------- | -------- | ------------------------------------------------ |
| `maxConcurrentExecutions` | `number` | Maximum number of concurrent executions (1-1000) |

When omitted, only platform-level limits apply.

```typescript
export default createWorkflow({
  name: "order-processing",
  mainJob: processOrder,
  concurrencyPolicy: {
    maxConcurrentExecutions: 5,
  },
});
```

## Triggering a Workflow from a Resolver

You can start a workflow execution from a resolver using `workflow.trigger()`.

- `workflow.trigger(args, options?)` returns a workflow run ID (`Promise<string>`).
- To run with machine-user permissions, pass `{ authInvoker: "<machine-user>" }`. The name is type-narrowed to the machine users defined in your auth config.

```typescript
import { createResolver, t } from "@tailor-platform/sdk";
import orderProcessingWorkflow from "../workflows/order-processing";

export default createResolver({
  name: "triggerOrderProcessing",
  operation: "mutation",
  input: {
    orderId: t.string(),
    customerId: t.string(),
  },
  body: async ({ input }) => {
    const workflowRunId = await orderProcessingWorkflow.trigger(
      { orderId: input.orderId, customerId: input.customerId },
      { authInvoker: "manager-machine-user" },
    );

    return { workflowRunId };
  },
  output: t.object({
    workflowRunId: t.string(),
  }),
});
```

> **Deprecated:** `auth.invoker("manager-machine-user")` still works but is deprecated. Using the string form avoids importing `auth` into runtime code.

See the full working example in the repository: [example/resolvers/triggerWorkflow.ts](https://github.com/tailor-platform/sdk/blob/main/example/resolvers/triggerWorkflow.ts).

## File Organization

Recommended file structure for workflows:

```
workflows/
├── jobs/
│   ├── fetch-customer.ts    # export const fetchCustomer = createWorkflowJob(...)
│   └── send-notification.ts # export const sendNotification = createWorkflowJob(...)
└── order-processing.ts      # export const processOrder = createWorkflowJob(...)
                             # export default createWorkflow(...)
```

All jobs can be in a single file or split across multiple files, as long as they are named exports.

## CLI Commands

Manage workflows using the CLI:

```bash
# List workflows
tailor-sdk workflow list

# Get workflow details
tailor-sdk workflow get <name>

# Start a workflow
tailor-sdk workflow start <name> -m <machine-user> -a '{"key": "value"}'

# List executions
tailor-sdk workflow executions

# Get execution details with logs
tailor-sdk workflow executions <execution-id> --logs

# Resume a failed execution
tailor-sdk workflow resume <execution-id>
```

See [Workflow CLI Commands](../cli/workflow.md) for full documentation.
