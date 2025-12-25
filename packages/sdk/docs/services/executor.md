# Executor

Executors are event-driven handlers that automatically trigger in response to data changes, schedules, or external events.

## Overview

Executors provide:

- Automatic triggers on record changes (create, update, delete)
- Scheduled execution via cron expressions
- Incoming webhook handlers
- Post-resolver execution hooks
- Multiple execution targets (functions, webhooks, GraphQL)

For the official Tailor Platform documentation, see [Executor Guide](https://docs.tailor.tech/guides/executor/overview).

## Creating an Executor

Define executors in files matching glob patterns specified in `tailor.config.ts`.

```typescript
import { createExecutor, recordCreatedTrigger, t } from "@tailor-platform/sdk";
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
      // Send welcome email logic here
    },
  },
});
```

## Trigger Types

### Record Triggers

Fire when records are created, updated, or deleted:

- `recordCreatedTrigger()`: Fires when a new record is created
- `recordUpdatedTrigger()`: Fires when a record is updated
- `recordDeletedTrigger()`: Fires when a record is deleted

Each trigger can include an optional filter function:

```typescript
recordUpdatedTrigger({
  type: order,
  condition: ({ newRecord, oldRecord }) =>
    newRecord.status === "completed" && oldRecord.status !== "completed",
});
```

### Schedule Trigger

Fires on a cron schedule:

```typescript
scheduleTrigger({ cron: "*/5 * * * *" }); // Every 5 minutes
scheduleTrigger({ cron: "0 9 * * 1" }); // Every Monday at 9am
scheduleTrigger({ cron: "0 0 1 * *" }); // First day of every month
scheduleTrigger({ cron: "0 * * * *", timezone: "Asia/Tokyo" });
```

### Incoming Webhook Trigger

Fires when an external webhook is received:

```typescript
type WebhookRequest = {
  body: WebhookPayload;
  headers: Record<string, string>;
};

incomingWebhookTrigger<WebhookRequest>();
```

### Resolver Executed Trigger

Fires when a resolver is executed:

```typescript
resolverExecutedTrigger({
  resolver: createOrderResolver,
  condition: ({ result, error }) => !error && result?.order?.id,
});
```

## Execution Targets

### Function Execution

Execute JavaScript/TypeScript functions:

```typescript
createExecutor({
  operation: {
    kind: "function",
    body: async ({ newRecord }) => {
      console.log("New record created:", newRecord);
    },
  },
});
```

### Webhook Execution

Call external webhooks with dynamic data:

```typescript
createExecutor({
  operation: {
    kind: "webhook",
    url: ({ typeName }) => `https://api.example.com/webhooks/${typeName}`,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": { vault: "api-keys", key: "external-api" },
    },
    requestBody: ({ newRecord }) => ({
      id: newRecord.id,
      timestamp: new Date(),
      data: newRecord,
    }),
  },
});
```

### GraphQL Execution

Execute GraphQL queries and mutations:

```typescript
createExecutor({
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `
      mutation UpdateUserStatus($id: ID!, $status: String!) {
        updateUser(id: $id, input: { status: $status }) {
          id
          status
          updatedAt
        }
      }
    `,
    variables: ({ newRecord }) => ({
      id: newRecord.userId,
      status: "active",
    }),
  },
});
```

## Event Payloads

Each trigger type provides specific context data in the callback functions.

### Record Event Payloads

Record triggers receive context based on the operation type:

#### Created Event

```typescript
interface RecordCreatedContext<T> {
  workspaceId: string; // Workspace identifier
  appNamespace: string; // Application/namespace name
  typeName: string; // TailorDB type name
  newRecord: T; // The newly created record
}
```

#### Updated Event

```typescript
interface RecordUpdatedContext<T> {
  workspaceId: string;
  appNamespace: string;
  typeName: string;
  oldRecord: T; // Previous record state
  newRecord: T; // Current record state
}
```

#### Deleted Event

```typescript
interface RecordDeletedContext<T> {
  workspaceId: string;
  appNamespace: string;
  typeName: string;
  oldRecord: T; // The deleted record
}
```

**Usage Example:**

```typescript
import { createExecutor, recordUpdatedTrigger, t } from "@tailor-platform/sdk";
import { order } from "../tailordb/order";

export default createExecutor({
  name: "order-status-changed",
  trigger: recordUpdatedTrigger({
    type: order,
    condition: ({ oldRecord, newRecord }) =>
      oldRecord.status !== newRecord.status,
  }),
  operation: {
    kind: "function",
    body: async ({ oldRecord, newRecord, typeName }) => {
      console.log(`${typeName} status changed:`);
      console.log(`  From: ${oldRecord.status}`);
      console.log(`  To: ${newRecord.status}`);
    },
  },
});
```

### Schedule Event Payload

Schedule triggers receive minimal context:

```typescript
interface ScheduleContext {
  scheduledTime: string; // ISO 8601 timestamp
}
```

### Incoming Webhook Payload

Webhook triggers receive HTTP request data:

```typescript
interface WebhookContext<T = unknown> {
  body: T; // Parsed request body
  headers: Record<string, string>; // Request headers
  method: "POST" | "GET" | "PUT" | "DELETE"; // HTTP method
  rawBody: string; // Raw request body as string
}
```

**Usage Example:**

```typescript
import { createExecutor, incomingWebhookTrigger } from "@tailor-platform/sdk";

interface StripeWebhook {
  type: string;
  data: { object: { id: string; amount: number } };
}

export default createExecutor({
  name: "stripe-webhook",
  trigger: incomingWebhookTrigger<{
    body: StripeWebhook;
    headers: { "stripe-signature": string };
  }>(),
  operation: {
    kind: "function",
    body: async ({ body, headers }) => {
      const signature = headers["stripe-signature"];
      console.log(`Received ${body.type} event`);
      // Process webhook...
    },
  },
});
```

### Resolver Executed Payload

Resolver triggers receive the resolver's result or error:

```typescript
interface ResolverExecutedContext<TResult> {
  workspaceId: string; // Workspace identifier
  appNamespace: string; // Application/namespace name
  resolverName: string; // Name of the executed resolver
  result?: TResult; // Return value (on success)
  error?: string; // Error message (on failure)
}
```

**Usage Example:**

```typescript
import { createExecutor, resolverExecutedTrigger } from "@tailor-platform/sdk";
import { createOrderResolver } from "../resolvers/create-order";

export default createExecutor({
  name: "order-created-notification",
  trigger: resolverExecutedTrigger({
    resolver: createOrderResolver,
    condition: ({ result, error }) => !error && !!result?.order,
  }),
  operation: {
    kind: "function",
    body: async ({ result, resolverName }) => {
      console.log(`${resolverName} completed successfully`);
      console.log(`Order ID: ${result.order.id}`);
    },
  },
});
```
