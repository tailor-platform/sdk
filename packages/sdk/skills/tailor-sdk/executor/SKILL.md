---
name: tailor-sdk/executor
description: >
  Set up event-driven automation with createExecutor. Triggers:
  recordCreatedTrigger, recordUpdatedTrigger, recordDeletedTrigger,
  scheduleTrigger (cron), incomingWebhookTrigger, resolverExecutedTrigger,
  idpUserCreatedTrigger, authAccessTokenIssuedTrigger. Operation kinds:
  function, graphql, webhook, workflow. authInvoker, secret references
  in webhook headers.
type: sub-skill
library: tailor-sdk
library_version: "1.25.1"
sources:
  - "tailor-platform/sdk:packages/sdk/docs/services/executor.md"
  - "tailor-platform/sdk:packages/sdk/src/configure/services/executor/executor.ts"
  - "tailor-platform/sdk:packages/sdk/src/configure/services/executor/trigger/"
  - "tailor-platform/sdk:example/executors/"
---

This skill builds on tailor-sdk. Read tailor-sdk/SKILL.md first for an overview.

# Executor

## Setup

One executor per file, default export:

```typescript
import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import type { order } from "../tailordb/order";

export default createExecutor({
  name: "order-created",
  description: "Handles new order creation",
  trigger: recordCreatedTrigger({
    type: order,
    condition: ({ newRecord }) => newRecord.totalPrice > 100000,
  }),
  operation: {
    kind: "function",
    body: async ({ newRecord }) => {
      console.log(`Order created: ${newRecord.id}`);
    },
  },
});
```

## Core Patterns

### Schedule trigger (cron)

```typescript
import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "daily-report",
  description: "Generate daily report at noon",
  trigger: scheduleTrigger({
    cron: "0 12 * * *",
    timezone: "Asia/Tokyo",
  }),
  operation: {
    kind: "function",
    body: async ({ env }) => {
      console.log("Running daily report");
    },
  },
});
```

### GraphQL operation with authInvoker

```typescript
import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { auth } from "../tailor.config";
import { gql } from "@urql/core";

export default createExecutor({
  name: "update-inventory",
  trigger: recordCreatedTrigger({ type: salesOrder }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: gql`
      mutation UpdateStock($id: ID!, $qty: Int!) {
        updateProduct(id: $id, input: { stock: $qty }) {
          id
        }
      }
    `,
    variables: ({ newRecord }) => ({
      id: newRecord.productId,
      qty: newRecord.quantity,
    }),
    authInvoker: auth.invoker("admin-machine-user"),
  },
});
```

### Webhook with secret references

```typescript
import { createExecutor, incomingWebhookTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "stripe-webhook",
  trigger: incomingWebhookTrigger<{ body: { type: string; data: unknown } }>(),
  operation: {
    kind: "webhook",
    url: () => "https://api.example.com/notify",
    requestBody: ({ body }) => ({ event: body.type }),
    headers: {
      Authorization: { vault: "api-keys", key: "stripe-token" },
    },
  },
});
```

### Resolver executed trigger

```typescript
import { createExecutor, resolverExecutedTrigger } from "@tailor-platform/sdk";
import myResolver from "../resolvers/myResolver";

export default createExecutor({
  name: "after-resolver",
  trigger: resolverExecutedTrigger({
    resolver: myResolver,
    condition: (args) => args.success && args.result.amount > 1000,
  }),
  operation: {
    kind: "function",
    body: async (args) => {
      if (args.success) {
        console.log("Resolver result:", args.result);
      }
    },
  },
});
```

## Common Mistakes

### CRITICAL Not default-exporting the executor

Wrong:

```typescript
export const myExecutor = createExecutor({ ... });
```

Correct:

```typescript
export default createExecutor({ ... });
```

Each executor file must have exactly one default export. Named exports are ignored.

Source: docs/services/executor.md

### HIGH Missing authInvoker in graphql/workflow operations

Wrong:

```typescript
operation: {
  kind: "graphql",
  query: gql`mutation { ... }`,
  variables: ({ newRecord }) => ({ id: newRecord.id }),
}
```

Correct:

```typescript
operation: {
  kind: "graphql",
  appName: "my-app",
  query: gql`mutation { ... }`,
  variables: ({ newRecord }) => ({ id: newRecord.id }),
  authInvoker: auth.invoker("admin-machine-user"),
}
```

GraphQL and workflow operations need authInvoker. Without it, the operation fails with a permission error.

Source: docs/services/executor.md

### HIGH Accessing result on failed resolverExecutedTrigger

Wrong:

```typescript
condition: (args) => args.result.someField > 0,
```

Correct:

```typescript
condition: (args) => args.success && args.result.someField > 0,
```

resolverExecutedTrigger args is a discriminated union on `success`. When `success` is false, `result` is undefined and `error` is available instead. Always check `success` first.

Source: packages/sdk/src/configure/services/executor/trigger/event.ts

### MEDIUM Function operation must return void

Wrong:

```typescript
operation: {
  kind: "function",
  body: async ({ newRecord }) => {
    return newRecord.id;
  },
}
```

Correct:

```typescript
operation: {
  kind: "function",
  body: async ({ newRecord }) => {
    console.log(newRecord.id);
  },
}
```

Function operations (kind: "function") must return void or Promise<void>. Returning a value is a type error.

Source: packages/sdk/src/configure/services/executor/operation.ts

### HIGH Async or complex logic in trigger conditions

Wrong:

```typescript
trigger: recordCreatedTrigger({
  type: order,
  condition: async ({ newRecord }) => {
    const result = await fetchExternalAPI(newRecord.id);
    return result.valid;
  },
}),
```

Correct:

```typescript
trigger: recordCreatedTrigger({
  type: order,
  condition: ({ newRecord }) => newRecord.status === "confirmed",
}),
```

Trigger conditions are pure synchronous functions. No async, no external calls. Handle complex logic in the operation body.

Source: maintainer interview

## References

- [Trigger types and event payloads](references/triggers.md)

See also: tailor-sdk/model-definition/SKILL.md — record triggers reference TailorDB types
See also: tailor-sdk/resolver/SKILL.md — resolverExecutedTrigger connects to resolver events
