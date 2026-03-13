---
name: tailor-sdk/resolver
description: >
  Implement custom GraphQL endpoints with createResolver. Covers t type
  builder for input/output schemas (t.string, t.int, t.object, t.enum),
  operation query/mutation, body context (input, user, env), .validate()
  on input fields, Kysely DB access via getDB(), triggering workflows
  from resolvers with authInvoker.
type: sub-skill
library: tailor-sdk
library_version: "1.25.1"
sources:
  - "tailor-platform/sdk:packages/sdk/docs/services/resolver.md"
  - "tailor-platform/sdk:packages/sdk/src/configure/services/resolver/resolver.ts"
  - "tailor-platform/sdk:example/resolvers/"
---

This skill builds on tailor-sdk. Read tailor-sdk/SKILL.md first for an overview.

# Resolver

## Setup

One resolver per file, default export:

```typescript
import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "add",
  description: "Add two numbers",
  operation: "query",
  input: {
    a: t.int().description("First number"),
    b: t.int().description("Second number"),
  },
  body: ({ input }) => {
    return { result: input.a + input.b };
  },
  output: t.object({
    result: t.int(),
  }),
});
```

## Core Patterns

### Mutation with database access

```typescript
import { createResolver, t } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";

export default createResolver({
  name: "createOrder",
  operation: "mutation",
  input: {
    customerId: t.uuid(),
    amount: t.int().validate([({ value }) => value > 0, "Amount must be positive"]),
  },
  body: async ({ input, user }) => {
    const db = getDB("tailordb");
    const order = await db
      .insertInto("Order")
      .values({ customerId: input.customerId, amount: input.amount })
      .returningAll()
      .executeTakeFirstOrThrow();
    return order;
  },
  output: t.object({
    id: t.uuid(),
    customerId: t.uuid(),
    amount: t.int(),
  }),
});
```

### Triggering a workflow from a resolver

```typescript
import { createResolver, t } from "@tailor-platform/sdk";
import orderWorkflow from "../workflows/processOrder";
import { auth } from "../tailor.config";

export default createResolver({
  name: "triggerOrderProcessing",
  operation: "mutation",
  input: {
    orderId: t.uuid(),
  },
  body: async ({ input }) => {
    const runId = await orderWorkflow.trigger(
      { orderId: input.orderId },
      { authInvoker: auth.invoker("admin-machine-user") },
    );
    return { runId };
  },
  output: t.object({ runId: t.string() }),
});
```

### Accessing user context and environment

```typescript
export default createResolver({
  name: "showUserInfo",
  operation: "query",
  body: ({ user, env }) => {
    return {
      userId: user.id,
      role: user.attributes.role,
      appName: env.appName,
    };
  },
  output: t.object({
    userId: t.uuid(),
    role: t.string(),
    appName: t.string(),
  }),
});
```

## Common Mistakes

### CRITICAL Not default-exporting the resolver

Wrong:

```typescript
export const myResolver = createResolver({ ... });
```

Correct:

```typescript
export default createResolver({ ... });
```

Each resolver file must have exactly one default export. Named exports are ignored by the SDK loader.

Source: docs/services/resolver.md

### HIGH Using db field types instead of t in resolver schemas

Wrong:

```typescript
import { db } from "@tailor-platform/sdk";
createResolver({
  input: { name: db.string() },
  output: db.object({ result: db.int() }),
});
```

Correct:

```typescript
import { t } from "@tailor-platform/sdk";
createResolver({
  input: { name: t.string() },
  output: t.object({ result: t.int() }),
});
```

Resolver input/output use the `t` type builder, not `db`. The `db` builder has DB-specific methods (relation, hooks) invalid in resolver context.

Source: docs/services/resolver.md

### HIGH Missing authInvoker when triggering workflow

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

Workflow triggers from resolvers require authInvoker for authentication. Without it, the call fails at runtime.

Source: example/resolvers/triggerWorkflow.ts

### HIGH Unsupported Kysely query features in resolvers

Kysely allows complex SQL (WITH, CTEs, window functions) but the Tailor Platform backend does not support all features. Use simple queries: SELECT, INSERT, UPDATE, DELETE with WHERE, JOIN, ORDER BY, LIMIT.

Source: maintainer interview

See also: tailor-sdk/workflow/SKILL.md — resolvers commonly trigger workflows
See also: tailor-sdk/code-generation/SKILL.md — resolvers use getDB() from generated types
See also: tailor-sdk/executor/SKILL.md — resolverExecutedTrigger connects to resolver events
