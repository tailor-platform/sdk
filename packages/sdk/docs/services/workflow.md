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

## Workflow Definition

Define a workflow using `createWorkflow` and export it as default:

```typescript
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { fetchCustomer } from "./jobs/fetch-customer";
import { sendNotification } from "./jobs/send-notification";

// Jobs must be named exports
export const processOrder = createWorkflowJob({
  name: "process-order",
  body: async (input: { customerId: string }, { env }) => {
    // `env` contains values from `tailor.config.ts` -> `env`.
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

## Triggering a Workflow from a Resolver

You can start a workflow execution from a resolver using `workflow.trigger()`.

- `workflow.trigger(args, options?)` returns a workflow run ID (`Promise<string>`).
- To run with machine-user permissions, pass `{ authInvoker: auth.invoker("<machine-user>") }`.

```typescript
import { createResolver, t } from "@tailor-platform/sdk";
import { auth } from "../tailor.config";
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
      { authInvoker: auth.invoker("manager-machine-user") },
    );

    return { workflowRunId };
  },
  output: t.object({
    workflowRunId: t.string(),
  }),
});
```

See the full working example in the repository: [example/resolvers/triggerWorkflow.ts](../../../../example/resolvers/triggerWorkflow.ts).

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
