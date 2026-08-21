# Workflow

Workflows orchestrate multiple jobs that can depend on each other, enabling complex multi-step operations with durable execution.

## Overview

Workflows provide:

- Job orchestration with dependencies
- Durable execution with automatic state management
- Resume capabilities from failure points
- Access to TailorDB via Kysely query builder
- Job starting to compose multi-step logic

For the official Tailor Platform documentation, see [Workflow Guide](https://docs.tailor.tech/guides/workflow).

## Workflow Rules

All workflow components must follow these rules:

**Definition Rules:**

- **One workflow + multiple jobs per file**: Each file can define multiple jobs (named exports) and one workflow (default export)
- **Workflow export method**: Must use `export default`
- **Job export method**: Must use named exports (`export const`)
- **Job name uniqueness**: Job names must be unique across the entire project (not just within one file)
- **mainJob required**: Every workflow must specify a `mainJob`

| Rule                                                                     | Description                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createWorkflow` result must be default export                           | Workflow files must export the workflow as default                                                                                                                                             |
| All jobs must be named exports                                           | Includes `mainJob` and any job started via `.start()` (even if referenced only within the same file)                                                                                           |
| Job `name` values must be unique                                         | Job names must be unique across the entire project                                                                                                                                             |
| `mainJob` is required                                                    | Every workflow must specify a `mainJob`                                                                                                                                                        |
| `createWorkflowJob`'s `name`/`body` must be written directly in the call | Not as a reference to a variable or the result of another function — the build cannot see through that indirection and fails instead of silently leaving the job out                           |
| `.start()` must be called from within the calling job's `body`           | A function defined inside `body` may call it too, but not a function defined outside `body` — the build cannot see through that indirection and fails instead of silently leaving the call out |
| Call `<job>.start()`, not `execJobFunction` directly                     | Calling `tailor.workflow.execJobFunction(...)` (or the `workflow` value imported from `@tailor-platform/sdk/runtime`) directly is not detected as a dependency and fails the build             |

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

## Starting Jobs

Use `.start()` to start other jobs from within a job.

Jobs are started by calling `.start()` on the other job object (no `deps` and no `jobs` object in the context).

```typescript
import { createWorkflowJob } from "@tailor-platform/sdk";
import { fetchCustomer } from "./jobs/fetch-customer";
import { sendNotification } from "./jobs/send-notification";

export const mainJob = createWorkflowJob({
  name: "main-job",
  body: (input: { customerId: string }) => {
    const customer = fetchCustomer.start({
      customerId: input.customerId,
    });
    const notification = sendNotification.start({
      message: "Order processed",
      recipient: customer.email,
    });
    return { customer, notification };
  },
});
```

### Deterministic Execution Requirement

Workflow jobs use a **suspend/resume execution model**. When a job calls `.start()`, the runtime suspends the current job, executes the started job, and then **re-executes the calling job from the beginning** with cached results from previous starts.

This means that **job code must be deterministic** — every re-execution must produce the same sequence of `.start()` calls with the same arguments in the same order.

Using `.start()` inside a loop works correctly, as long as the loop is deterministic:

```typescript
// ✅ OK: deterministic loop — same calls in the same order on every execution
const regions = ["us", "eu", "ap"];
for (const region of regions) {
  const result = fetchData.start({ region });
  results.push(result);
}
```

```typescript
// ❌ Bad: non-deterministic — argument changes between executions
processJob.start({ timestamp: Date.now() });

// ✅ OK: call Date.now() in a separate job
const timestamp = timestampJob.start();
processJob.start({ timestamp });
```

```typescript
// ❌ Bad: non-deterministic — external data may change between executions
const items = await fetch("https://api.example.com/items").then((r) => r.json());
for (const item of items) {
  processItem.start({ id: item.id });
}

// ✅ OK: call fetch("https://api.example.com/items").then((r) => r.json()); in a separate job
const items = fetchItemsJob.start();
for (const item of items) {
  processItem.start({ id: item.id });
}
```

If the runtime detects that a `.start()` call at the same position has different arguments than the previous execution, it will throw an **argument hash mismatch error**.

**Guidelines:**

- Do not use non-deterministic values (random numbers, timestamps, external API responses) as `.start()` arguments.
- Do not use conditions that may change between executions to decide whether to call `.start()`.
- Any data that varies between executions should be fetched **inside the started job**, not passed as an argument from the calling job.

## Workflow Definition

Define a workflow using `createWorkflow` and export it as default:

```typescript
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { fetchCustomer } from "./jobs/fetch-customer";
import { sendNotification } from "./jobs/send-notification";

// Jobs must be named exports
export const processOrder = createWorkflowJob({
  name: "process-order",
  body: (input: { customerId: string }, { env, invoker }) => {
    // `env` contains values from `tailor.config.ts` -> `env`.
    // `invoker` is the principal running this job, or the machine user
    // configured through the start `invoker` option; `null` for anonymous calls.
    // Start other jobs by calling .start() on the job object.
    const customer = fetchCustomer.start({
      customerId: input.customerId,
    });
    sendNotification.start({
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

## Execution Events

Workflows can publish execution lifecycle events for executors. When an executor subscribes to a workflow's events, `deploy` enables publishing automatically. A `workflowExecution*` trigger enables it on the workflow, and a `workflowJobExecution*` trigger enables it on every job that workflow runs. See [Workflow Execution Triggers](./executor.md#workflow-execution-triggers).

Publishing follows the subscription in both directions: removing the last subscribing trigger turns it back off on the next `deploy`.

Set `publishEvents` explicitly to pin the value instead. Use `true` to publish workflow-level events with no subscribing executor:

```typescript
export default createWorkflow({
  name: "order-processing",
  mainJob: processOrder,
  publishEvents: true,
});
```

A job takes the same field for its own execution events:

```typescript
export const processOrder = createWorkflowJob({
  name: "process-order",
  publishEvents: true,
  body: async () => ({ processed: true }),
});
```

Use `false` to keep publishing off. `deploy` fails if an executor subscribes to events the value opts out of, so the subscription cannot silently go unfulfilled.

**Subscribing from another config:** an executor in another config auto-enables publishing the same way, as long as both configs take part in the same `deploy` (`--config a,b`). The workflow a `workflowExecution*` or `workflowJobExecution*` trigger names must be declared by a config in the run; `deploy` fails otherwise rather than creating an executor whose events never arrive. `deploy` records the dependency on the workflow itself, so deploying that config alone later asks for confirmation instead of silently turning publishing off. Declaring `publishEvents` clears the record: a declared value no longer depends on which configs are deployed together, so there is nothing left to warn about.

## Wait Points

Wait points allow a workflow job to suspend execution and wait for an external signal before resuming. This enables human-in-the-loop patterns such as approvals, reviews, and manual confirmations.

### Defining Wait Points

Use `createWaitPoint` to create a single typed wait point:

```typescript
import { createWaitPoint } from "@tailor-platform/sdk";

export const approval = createWaitPoint<
  { message: string; requestId: string },
  { approved: boolean }
>("approval");
```

Keys must match `[a-z0-9-]`, be 3 to 63 characters long, and start and end with `[a-z0-9]`.

For multiple wait points, use `createWaitPoints` with a builder callback. Property names become wait point keys, and JSDoc on each property is preserved in IDE autocompletion:

```typescript
import { createWaitPoints } from "@tailor-platform/sdk";

export const waitPoints = createWaitPoints((define) => ({
  /** Manager approval step */
  "manager-approval": define<{ amount: number }, { approved: boolean }>(),
  /** Finance review step */
  "finance-review": define<{ invoiceId: string }, { validated: boolean }>(),
}));

await waitPoints["manager-approval"].wait({ amount: 50000 });
```

Pass the key to `define` when the property name you want to read at the call site is not a valid key:

```typescript
export const waitPoints = createWaitPoints((define) => ({
  managerApproval: define.for("manager-approval")<{ amount: number }, { approved: boolean }>(),
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
import { createWaitPoint, createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const approval = createWaitPoint<
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

### Keys With Runtime Values

A wait point key identifies one suspension inside one execution. When a job suspends more than once for the same reason — one approval per order line, one per approver — every suspension needs its own key, otherwise the second `wait()` fails because a suspension with that key is already pending.

Write `$paramName` as a whole `-`-delimited segment of the key to leave a slot for a runtime value — `line-approval-$lineId` works, `line-approval$lineId` does not. Declare such a key through `createWaitPoints`, passing it to `define` **before** the `Payload` and `Result` type arguments — the param names then become the argument of `.with()`, which builds the concrete key:

```typescript
export const { lineApproval } = createWaitPoints((define) => ({
  lineApproval: define.for("line-approval-$lineId")<{ message: string }, { approved: boolean }>(),
}));

// Suspends on "line-approval-<lineId>", so parallel lines never collide
const result = await lineApproval.with({ lineId: line.id }).wait({ message: "Please approve" });
```

The key has to come before the type arguments because TypeScript stops inferring it as a literal type once `Payload` and `Result` are given explicitly, and the param names can only be read off a literal. `createWaitPoint` takes its type arguments first, so it cannot type `$params` at all, and `deploy` rejects such a key — one wait point per key is what it is for, and a key with `$params` stands for a family of them.

`deploy` checks every declared key against the grammar above, so a key the platform would reject is reported before anything is deployed.

A parameterized wait point exposes only `.with()` — there is no way to wait on the unsubstituted key.

Resolve it from the same param values:

```typescript
await lineApproval.with({ lineId: input.lineId }).resolve(input.executionId, (payload) => {
  console.log("Resolving:", payload.message);
  return { approved: input.approved };
});
```

Rules to keep in mind:

- Param values must match `[a-z0-9-]`, cannot be empty, and cannot start or end with `-`. Record IDs work as-is; uppercase or underscored values do not.
- The composed key still has to fit 63 characters. A UUID takes 36, so a key holding one leaves 26 characters for everything else.
- The key needs at least one literal segment alongside its `$params`, so `"$lineId"` alone is rejected: a key made only of caller data carries no identity of its own.
- Param values are part of the key, so they must be derived from the job's input. A value from `Date.now()` or `Math.random()` changes when the platform replays the job and the execution fails.
- Keys are compared exactly, and the SDK does not check whether two declared keys can produce the same string. `"a-$x"` with `x = "b-c"` and `"a-b-$y"` with `y = "c"` both produce `a-b-c`. Keep the literal part of each key distinct, and prefer putting `$params` last.

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

## Execution Policies

Execution policies apply a per-key concurrency cap to workflow job function dispatches. Declare them at the workspace level and pass a matching key when starting a job; the platform serializes dispatches that resolve to the same key and suspends any that would exceed the cap until slots free up.

### Declaring Policies

Use `defineWorkflowExecutionPolicies` with a builder callback. Property names supply the workspace-unique name and default key prefix verbatim, matching the mental model of `createWaitPoints`. Override `name` or `key` in the body when the property identifier is not valid execution policy grammar or the key prefix needs to differ. Set `matchType: "prefix"` to register the prefix as a wildcard that matches every dispatch key starting with it (the default, `"exact"`, matches only a dispatch key equal to it).

```typescript
import { defineWorkflowExecutionPolicies } from "@tailor-platform/sdk";

export const executionPolicies = defineWorkflowExecutionPolicies((define) => ({
  /** Shared cap across every "premium" worker dispatch. */
  premium: define({ concurrencyPolicy: { maxConcurrentExecutions: 5 } }),
  /** Per-tenant cap: one pool per resolved tenant key. */
  tenantApi: define({
    name: "tenant-api",
    matchType: "prefix",
    concurrencyPolicy: { maxConcurrentExecutions: 3 },
  }),
}));
```

For a single policy, use `defineWorkflowExecutionPolicy(name, def?)`; the key prefix defaults to `name` when `key` is omitted.

`concurrencyPolicy` is optional; when omitted, the policy registers the key as valid without a user-defined limit (platform safety nets still apply).

Register the policies on your config so the SDK creates them on the workspace during deploy:

```typescript
// tailor.config.ts
import { defineConfig } from "@tailor-platform/sdk";
import { executionPolicies } from "./workflows/policies";

export default defineConfig({
  workflow: {
    files: ["workflows/**/*.ts"],
    executionPolicies,
  },
});
```

### Key Grammar

`key` accepts `[a-z0-9_:.-]` and must start with `[a-z0-9]`. An exact key must also end with `[a-z0-9]`; a wildcard prefix (`matchType: "prefix"`) may end with any of those characters, since the platform appends a trailing `*` after it. The platform-registered key — including that trailing `*` when wildcarded — is 2 to 64 characters long, so a wildcard prefix must be at most 63 characters. `foo:bar` is a valid exact key; `tenant-api` with `matchType: "prefix"` registers `tenant-api*` as a wildcard prefix.

An exact-key policy applies to dispatches whose runtime key equals the policy key. A wildcard policy applies to every dispatch whose runtime key begins with the prefix; each concrete resolved key gets its own independent pool of the declared size (a `cap = 3` wildcard yields three concurrent dispatches per resolved key, not three across every match). When a dispatch matches more than one policy (for example, an exact key that also falls under a wildcard prefix, or two wildcard prefixes where one starts with the other), every matching policy's cap is enforced independently, and the tightest one blocks.

### Referencing a Policy from a Workflow

Pass the runtime key through the `executionPolicyKey` option on `job.start()`. For exact-key policies, use `<policy>.key` directly — it's typed so only a value that came from a declared policy can be passed. For wildcard policies (`matchType: "prefix"`), there is no `<policy>.key` — call `<policy>.keyFor(suffix)` to build the concrete key. `keyFor` joins the prefix and suffix with `.` by default; override it with `separator` — the second argument to `defineWorkflowExecutionPolicies` (applies to every policy in the group), or a `def` field on a single `defineWorkflowExecutionPolicy`.

```typescript
import { createWorkflowJob } from "@tailor-platform/sdk";
import { executionPolicies } from "./policies";
import { sendNotification } from "./jobs/send-notification";
import { fetchTenant } from "./jobs/fetch-tenant";

export const mainJob = createWorkflowJob({
  name: "main-job",
  body: async (input: { tenantId: string }) => {
    // Exact key policy: pass .key directly.
    await sendNotification.start(
      { message: "Order processed" },
      { executionPolicyKey: executionPolicies.premium.key },
    );

    // Wildcard policy: build the concrete key with keyFor().
    await fetchTenant.start(
      { tenantId: input.tenantId },
      { executionPolicyKey: executionPolicies.tenantApi.keyFor(input.tenantId) },
    );
  },
});
```

## Starting a Workflow from a Resolver

You can start a workflow execution from a resolver using `workflow.start()`.

- `workflow.start(args, options?)` returns a workflow run ID (`Promise<string>`).
- To run with machine-user permissions, pass `{ invoker: "<machine-user>" }`. The name is type-narrowed to the machine users defined in your auth config.

```typescript
import { createResolver, t } from "@tailor-platform/sdk";
import orderProcessingWorkflow from "../workflows/order-processing";

export default createResolver({
  name: "startOrderProcessing",
  operation: "mutation",
  input: {
    orderId: t.string(),
    customerId: t.string(),
  },
  body: async ({ input }) => {
    const workflowRunId = await orderProcessingWorkflow.start(
      { orderId: input.orderId, customerId: input.customerId },
      { invoker: "manager-machine-user" },
    );

    return { workflowRunId };
  },
  output: t.object({
    workflowRunId: t.string(),
  }),
});
```

See the full working example in the repository: [example/resolvers/startWorkflow.ts](https://github.com/tailor-platform/sdk/blob/main/example/resolvers/startWorkflow.ts).

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
tailor workflow list

# Get workflow details
tailor workflow get <name>

# Start a workflow
tailor workflow start <name> -m <machine-user> -a '{"key": "value"}'

# List executions
tailor workflow executions

# Get execution details with logs
tailor workflow executions <execution-id> --logs

# Resume a failed execution
tailor workflow resume <execution-id>
```

See [Workflow CLI Commands](../cli/workflow.md) for full documentation.
