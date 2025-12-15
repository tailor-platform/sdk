# Workflow

Workflows orchestrate multiple jobs that can depend on each other, enabling complex multi-step operations with durable execution.

## Overview

Workflows provide:

- Job orchestration with dependencies
- Durable execution with automatic state management
- Resume capabilities from failure points
- Access to TailorDB via Kysely query builder
- Job triggering for parallel or sequential execution

For the official Tailor Platform documentation, see [Workflow Guide](https://docs.tailor.tech/guides/workflow).

## Workflow Rules

All workflow components must follow these rules:

| Rule                                           | Description                                         |
| ---------------------------------------------- | --------------------------------------------------- |
| `createWorkflow` result must be default export | Workflow files must export the workflow as default  |
| All jobs must be named exports                 | Every job used in a workflow must be a named export |
| Job names must be unique                       | Job names must be unique across the entire project  |
| `mainJob` is required                          | Every workflow must specify a `mainJob`             |
| Jobs in `deps` must be job objects             | Pass job objects, not strings                       |

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

## Job Dependencies

Jobs can depend on other jobs using the `deps` array. Dependent jobs are accessible via the second argument of `body` function with hyphens replaced by underscores:

```typescript
import { createWorkflowJob } from "@tailor-platform/sdk";
import { fetchCustomer } from "./jobs/fetch-customer";
import { sendNotification } from "./jobs/send-notification";

// All jobs must be named exports - including jobs with dependencies
export const processOrder = createWorkflowJob({
  name: "process-order",
  deps: [fetchCustomer, sendNotification],
  body: async (input: { orderId: string; customerId: string }, { jobs }) => {
    // Access dependent jobs with hyphens replaced by underscores
    // "fetch-customer" -> jobs.fetch_customer()
    // "send-notification" -> jobs.send_notification()
    const customer = await jobs.fetch_customer({
      customerId: input.customerId,
    });

    const notification = await jobs.send_notification({
      message: `Order ${input.orderId} is being processed`,
      recipient: customer.email,
    });

    return {
      orderId: input.orderId,
      customerEmail: customer.email,
      notificationSent: notification.sent,
    };
  },
});
```

## Triggering Jobs

Use `.trigger()` to start other jobs from within a job:

```typescript
export const mainJob = createWorkflowJob({
  name: "main-job",
  deps: [fetchCustomer, sendNotification],
  body: (input: { customerId: string }, { jobs }) => {
    // .trigger() is synchronous on server - do NOT use await
    // "fetch-customer" -> jobs.fetch_customer
    const customer = jobs.fetch_customer.trigger({
      customerId: input.customerId,
    });
    const notification = jobs.send_notification.trigger({
      message: "Order processed",
      recipient: customer.email,
    });
    return { customer, notification };
  },
});
```

**Important:** `.trigger()` is synchronous on the server. Do NOT use `await` with it.

## Workflow Definition

Define a workflow using `createWorkflow` and export it as default:

```typescript
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { fetchCustomer } from "./jobs/fetch-customer";
import { sendNotification } from "./jobs/send-notification";

// Jobs must be named exports
export const processOrder = createWorkflowJob({
  name: "process-order",
  deps: [fetchCustomer, sendNotification],
  body: async (input, { jobs }) => {
    // ... job logic
  },
});

// Workflow must be default export
export default createWorkflow({
  name: "order-processing",
  mainJob: processOrder,
});
```

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
tailor-sdk workflow start <name> -m <machine-user> -g '{"key": "value"}'

# List executions
tailor-sdk workflow executions

# Get execution details with logs
tailor-sdk workflow executions <execution-id> --logs

# Resume a failed execution
tailor-sdk workflow resume <execution-id>
```

See [Workflow CLI Commands](../cli/workflow.md) for full documentation.
