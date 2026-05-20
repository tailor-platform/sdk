# Executor

Executors are event-driven handlers that automatically trigger in response to data changes, schedules, or external events.

## Overview

Executors provide:

- Automatic triggers on record changes (create, update, delete)
- Scheduled execution via cron expressions
- Incoming webhook handlers
- Post-resolver execution hooks
- Multiple operation types (functions, webhooks, GraphQL, workflows)

For the official Tailor Platform documentation, see [Executor Guide](https://docs.tailor.tech/guides/executor/overview).

## Creating an Executor

Define executors in files matching glob patterns specified in `tailor.config.ts`.

**Definition Rules:**

- **One executor per file**: Each file must contain exactly one executor definition
- **Export method**: Must use `export default`
- **Uniqueness**: Executor names must be unique globally across your entire application

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

You can customize the HTTP response returned to the webhook caller:

```typescript
// Response body only (shorthand)
incomingWebhookTrigger<WebhookRequest>({
  response: (args) => ({ challenge: args.body.challenge }),
});

// Response body with custom status code
incomingWebhookTrigger<WebhookRequest>({
  response: {
    body: (args) => ({ challenge: args.body.challenge }),
    statusCode: 201,
  },
});
```

If `body` is set without `statusCode`, the platform uses 200. If neither is set, the platform returns 204.

### Resolver Executed Trigger

Fires when a resolver is executed:

```typescript
resolverExecutedTrigger({
  resolver: createOrderResolver,
  condition: ({ result, error }) => !error && result?.order?.id,
});
```

### IdP User Triggers

Fire when IdP users are created, updated, or deleted:

- `idpUserCreatedTrigger()`: Fires when a new IdP user is created
- `idpUserUpdatedTrigger()`: Fires when an IdP user is updated
- `idpUserDeletedTrigger()`: Fires when an IdP user is deleted

```typescript
idpUserCreatedTrigger();
```

When the project defines multiple IdPs, pass `idp` to target a specific one. The name is type-narrowed via the generated `IdpName` type:

```typescript
idpUserCreatedTrigger({ idp: "my-idp" });
```

Omitting `idp` is allowed only when the project has exactly one IdP; otherwise `apply` fails with an error listing the configured IdPs.

These triggers require the IdP to publish user lifecycle events. The SDK enables `publishUserEvents` automatically during `apply` on each IdP that is targeted by an `idpUser` trigger; set the value explicitly on `defineIdp()` to override. See [IdP service - publishUserEvents](./idp.md#publishuserevents).

### Auth Access Token Triggers

Fire on auth access token lifecycle events:

- `authAccessTokenIssuedTrigger()`: Fires when a new access token is issued
- `authAccessTokenRefreshedTrigger()`: Fires when an access token is refreshed
- `authAccessTokenRevokedTrigger()`: Fires when an access token is revoked

```typescript
authAccessTokenIssuedTrigger();
```

### Multi-Event Triggers

Handle multiple event types in a single executor using multi-event trigger factories. These accept an `events` array of short event names:

#### `recordTrigger()`

```typescript
import { createExecutor, recordTrigger } from "@tailor-platform/sdk";
import { user } from "../tailordb/user";

export default createExecutor({
  name: "user-changed",
  trigger: recordTrigger({
    type: user,
    events: ["created", "updated"],
  }),
  operation: {
    kind: "function",
    body: async (args) => {
      if (args.event === "created") {
        console.log("User created:", args.newRecord.name);
      }
      if (args.event === "updated") {
        console.log("User updated:", args.oldRecord.name, "->", args.newRecord.name);
      }
    },
  },
});
```

#### `idpUserTrigger()`

```typescript
idpUserTrigger({ events: ["created", "deleted"] });
```

In multi-IdP projects, add `idp` to target a specific IdP:

```typescript
idpUserTrigger({ events: ["created", "deleted"], idp: "my-idp" });
```

#### `authAccessTokenTrigger()`

```typescript
authAccessTokenTrigger({ events: ["issued", "revoked"] });
```

The `event` field on args matches the short event name (e.g., `"created"`, `"updated"`, `"deleted"`, `"issued"`, `"refreshed"`, `"revoked"`), enabling type narrowing. The `rawEvent` field contains the full event type string (e.g., `"tailordb.type_record.created"`).

## Operation Types

### Function Operation

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

`function` and `jobFunction` `body` args include an `invoker` field: the principal running this function, overridden by `authInvoker` when set; `null` for anonymous calls. Other operation kinds (`graphql`, `webhook`, `workflow`) do not pass `invoker` into their callbacks.

### Job Function Operation

For long-running operations, use `jobFunction` which runs asynchronously and supports extended execution times. See [Job Function Operation](https://docs.tailor.tech/guides/executor/job-function-operation) for details.

```typescript
import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";

export default createExecutor({
  name: "daily-report-generator",
  description: "Generate daily reports",
  trigger: scheduleTrigger({ cron: "0 0 * * *" }),
  operation: {
    kind: "jobFunction",
    body: async () => {
      const db = getDB("tailordb");
      // Long-running report generation logic
      const records = await db.selectFrom("Order").selectAll().execute();
      // Process records...
    },
  },
});
```

### Webhook Operation

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

### GraphQL Operation

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

### Workflow Operation

Trigger workflows from executors. See [Workflow documentation](./workflow.md) for how to define workflows.

```typescript
import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { order } from "../tailordb/order";
import processOrderWorkflow from "../workflows/process-order";

export default createExecutor({
  name: "order-processor",
  description: "Process new orders via workflow",
  trigger: recordCreatedTrigger({ type: order }),
  operation: {
    kind: "workflow",
    workflow: processOrderWorkflow,
    args: ({ newRecord }) => ({
      orderId: newRecord.id,
      customerId: newRecord.customerId,
    }),
  },
});
```

You can also pass static arguments:

```typescript
createExecutor({
  operation: {
    kind: "workflow",
    workflow: dailyReportWorkflow,
    args: { reportType: "summary" },
  },
});
```

### Authentication for Operations

GraphQL and Workflow operations can specify an `authInvoker` to execute with machine user credentials. Pass the machine user name as a plain string — it is type-narrowed to the names defined in your auth config:

```typescript
import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "scheduled-cleanup",
  trigger: scheduleTrigger({ cron: "0 0 * * *" }),
  operation: {
    kind: "graphql",
    query: `mutation { cleanupOldRecords { count } }`,
    authInvoker: "batch-processor",
  },
});
```

> **Deprecated:** `auth.invoker("batch-processor")` still works, but is deprecated. Prefer the string form to avoid importing config-layer modules into runtime files.

## Event Payloads

Each trigger type provides specific context data in the callback functions.

### Record Event Payloads

Record triggers receive context based on the operation type:

#### Created Event

```typescript
interface RecordCreatedContext<T> {
  event: "created"; // Short event name for type narrowing
  rawEvent: "tailordb.type_record.created"; // Full event type string
  workspaceId: string; // Workspace identifier
  appNamespace: string; // Application/namespace name
  typeName: string; // TailorDB type name
  newRecord: T; // The newly created record
}
```

#### Updated Event

```typescript
interface RecordUpdatedContext<T> {
  event: "updated";
  rawEvent: "tailordb.type_record.updated";
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
  event: "deleted";
  rawEvent: "tailordb.type_record.deleted";
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
    condition: ({ oldRecord, newRecord }) => oldRecord.status !== newRecord.status,
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

**With custom response:**

```typescript
export default createExecutor({
  name: "slack-challenge",
  trigger: incomingWebhookTrigger<{
    body: { challenge: string; type: string };
    headers: Record<string, string>;
  }>({
    response: (args) => ({ challenge: args.body.challenge }),
  }),
  operation: {
    kind: "function",
    body: async ({ body }) => {
      console.log(`Received ${body.type} event`);
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

### IdP User Event Payload

IdP user triggers receive user context:

```typescript
interface IdpUserContext {
  event: "created" | "updated" | "deleted"; // Short event name
  rawEvent: string; // Full event type (e.g., "idp.user.created")
  namespaceName: string; // IdP namespace name
  userId: string; // The affected user ID
}
```

### Auth Access Token Event Payload

Auth access token triggers receive token context:

```typescript
interface AuthAccessTokenContext {
  event: "issued" | "refreshed" | "revoked"; // Short event name
  rawEvent: string; // Full event type (e.g., "auth.access_token.issued")
  namespaceName: string; // Auth namespace name
  userId: string; // The user associated with the token
}
```
