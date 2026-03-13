---
name: services/executor
description: Use this skill when creating or modifying executors — event-driven handlers triggered by record changes, schedules, webhooks, or resolver execution.
metadata:
  sources:
    - docs/services/executor.md
---

# Executor Service

Executors are event-driven handlers that automatically trigger in response to data changes, schedules, or external events. They connect triggers (what happened) with operations (what to do about it).

## Setup

```typescript
import {
  createExecutor,
  recordCreatedTrigger,
  recordUpdatedTrigger,
  recordDeletedTrigger,
  scheduleTrigger,
  incomingWebhookTrigger,
  resolverExecutedTrigger,
} from "@tailor-platform/sdk";
```

Definition rules:

- One executor per file, must use `export default`
- Executor names must be globally unique across the entire project
- Files must match glob patterns specified in `tailor.config.ts`

## Core Patterns

### Basic Executor Structure

```typescript
import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { user } from "../tailordb/user";

export default createExecutor({
  name: "user-welcome",
  description: "Send welcome email to new users",
  trigger: recordCreatedTrigger({
    type: user,
    condition: ({ newRecord }) => !!newRecord.email && newRecord.isActive,
  }),
  operation: {
    kind: "function",
    body: async ({ newRecord }) => {
      // Handle new user
    },
  },
});
```

### Trigger Types

#### Record Triggers

Record triggers fire on CRUD events for a TailorDB type. The type must have `publishEvents` enabled (auto-detected when a record trigger references it).

```typescript
// Created — args contain newRecord
recordCreatedTrigger({ type: someType });

// Updated — args contain newRecord and oldRecord
recordUpdatedTrigger({
  type: order,
  condition: ({ newRecord, oldRecord }) =>
    newRecord.status === "completed" && oldRecord.status !== "completed",
});

// Deleted — args contain oldRecord
recordDeletedTrigger({ type: someType });
```

Event payloads also include: `workspaceId`, `appNamespace`, `typeName`.

#### Schedule Trigger

Fires on a CRON schedule. Expression is validated at compile time.

```typescript
scheduleTrigger({ cron: "*/5 * * * *" }); // Every 5 minutes
scheduleTrigger({ cron: "0 9 * * 1" }); // Monday at 9am
scheduleTrigger({ cron: "0 0 * * *", timezone: "Asia/Tokyo" }); // Midnight JST
```

Payload: `{ scheduledTime: string }` (ISO 8601).

#### Incoming Webhook Trigger

Fires when an external HTTP request hits the webhook endpoint. Parameterized with body and header types.

```typescript
interface StripeWebhook {
  type: string;
  data: { object: { id: string; amount: number } };
}

incomingWebhookTrigger<{
  body: StripeWebhook;
  headers: { "stripe-signature": string };
}>();
```

Payload: `{ body, headers, method, rawBody }`.

#### Resolver Executed Trigger

Fires after a resolver completes. The payload is a discriminated union: check `error` to narrow between success and failure.

```typescript
resolverExecutedTrigger({
  resolver: createOrderResolver,
  condition: ({ result, error }) => !error && !!result?.order,
});
```

Payload: `{ workspaceId, appNamespace, resolverName, result?, error? }`.

#### IdP and Auth Triggers

Additional triggers for identity and auth events:

- `idpUserCreatedTrigger`, `idpUserUpdatedTrigger`, `idpUserDeletedTrigger`
- `authAccessTokenIssuedTrigger`, `authAccessTokenRefreshedTrigger`, `authAccessTokenRevokedTrigger`

### Operation Types

#### Function Operation

Inline TypeScript/JavaScript handler. Most common for simple logic.

```typescript
operation: {
  kind: "function",
  body: async ({ newRecord }) => {
    console.log("Created:", newRecord.id);
  },
}
```

#### Job Function Operation

For long-running async operations with extended execution times.

```typescript
operation: {
  kind: "jobFunction",
  body: async () => {
    const db = getDB("tailordb");
    const records = await db.selectFrom("Order").selectAll().execute();
    // Long-running processing...
  },
}
```

#### GraphQL Operation

Execute a GraphQL query or mutation. Use `authInvoker` for machine user credentials.

```typescript
operation: {
  kind: "graphql",
  appName: "my-app",
  query: `
    mutation UpdateUserStatus($id: ID!, $status: String!) {
      updateUser(id: $id, input: { status: $status }) { id status }
    }
  `,
  variables: ({ newRecord }) => ({
    id: newRecord.userId,
    status: "active",
  }),
  authInvoker: auth.invoker("batch-processor"),
}
```

#### Webhook Operation

Call an external HTTP endpoint. Supports secret references in headers via `{ vault, key }`.

```typescript
operation: {
  kind: "webhook",
  url: ({ typeName }) => `https://api.example.com/webhooks/${typeName}`,
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": { vault: "api-keys", key: "external-api" },
  },
  requestBody: ({ newRecord }) => ({
    id: newRecord.id,
    data: newRecord,
  }),
}
```

#### Workflow Operation

Trigger a workflow, passing arguments from the trigger context.

```typescript
import processOrderWorkflow from "../workflows/process-order";

operation: {
  kind: "workflow",
  workflow: processOrderWorkflow,
  args: ({ newRecord }) => ({
    orderId: newRecord.id,
    customerId: newRecord.customerId,
  }),
  authInvoker: auth.invoker("batch-processor"),
}
```

Static arguments are also supported: `args: { reportType: "summary" }`.

### Authentication (authInvoker)

GraphQL and workflow operations can specify `authInvoker` to run as a machine user:

```typescript
import { defineAuth } from "@tailor-platform/sdk";

const auth = defineAuth("my-auth", {
  machineUsers: {
    "batch-processor": {
      attributes: { role: "ADMIN" },
    },
  },
});

// Then in operation:
authInvoker: auth.invoker("batch-processor");
```

### Disabling an Executor

Set `disabled: true` to temporarily deactivate an executor without deleting it:

```typescript
export default createExecutor({
  name: "order-processor",
  disabled: true,
  // ...
});
```

## Common Mistakes

### CRITICAL: Executor name not globally unique

Executor names must be unique across all executor files in the entire project, not just within a directory.

```typescript
// BAD — two files both using the same name
// executors/orders.ts
export default createExecutor({ name: "process-record", ... });
// executors/users.ts
export default createExecutor({ name: "process-record", ... });

// GOOD — unique, descriptive names
export default createExecutor({ name: "process-order-record", ... });
export default createExecutor({ name: "process-user-record", ... });
```

### HIGH: Record trigger on type without publishEvents

Record triggers require the referenced TailorDB type to have event publishing enabled. The SDK auto-detects this when a record trigger references a type, but if `publishEvents` is explicitly set to `false` on the type, the executor will never fire.

### HIGH: Wrong secret reference syntax in webhook headers

Secret references must use the exact shape `{ vault: "vault-name", key: "secret-name" }`. Using incorrect property names or a plain string will expose or lose the secret.

```typescript
// BAD
headers: { "X-API-Key": "sk-hardcoded-secret" }
headers: { "X-API-Key": { vaultName: "keys", secretKey: "api" } }

// GOOD
headers: { "X-API-Key": { vault: "api-keys", key: "external-api" } }
```

### MEDIUM: Not narrowing resolverExecutedTrigger payload

The resolver executed payload is a discriminated union on the presence of `error`. Always check `error` before accessing `result`.

```typescript
// BAD — result may be undefined on error
body: async ({ result }) => {
  console.log(result.order.id);
};

// GOOD — narrow first
body: async ({ result, error }) => {
  if (error) {
    console.error("Resolver failed:", error);
    return;
  }
  console.log(result.order.id);
};
```

### MEDIUM: Invalid CRON expression

CRON expressions are validated at compile time. Use standard 5-field cron syntax. Common mistakes include using 6 fields (with seconds) or invalid ranges.

```typescript
// BAD — 6 fields (seconds not supported)
scheduleTrigger({ cron: "0 */5 * * * *" });

// GOOD — 5 fields
scheduleTrigger({ cron: "*/5 * * * *" });
```

## Cross-References

- **services/tailordb** — Record triggers reference TailorDB types; `publishEvents` is auto-detected when a type is used in a record trigger
- **services/resolver** — `resolverExecutedTrigger` references a resolver created with `createResolver`
- **services/workflow** — Workflow operations trigger workflows created with `createWorkflow`
