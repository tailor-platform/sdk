---
name: tailor-sdk-resolver
description: Create custom GraphQL query and mutation endpoints with createResolver(). Covers typed input/output schemas using t.* field types, input validation, Kysely database access via getDB(), context (input, env, user), pickFields/omitFields for type reuse, and publishEvents.
metadata:
  sources:
    - docs/services/resolver.md
---

# Resolver

Custom GraphQL endpoints with business logic. One resolver per file, default export only.

## Setup

```typescript
import { createResolver, t } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";

export default createResolver({
  name: "add",
  description: "Addition operation",
  operation: "query",
  input: {
    left: t.int(),
    right: t.int(),
  },
  body: ({ input }) => {
    return { result: input.left + input.right };
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
  name: "incrementUserAge",
  operation: "mutation",
  input: { email: t.string() },
  body: async (context) => {
    const db = getDB("tailordb");
    const user = await db
      .selectFrom("User")
      .selectAll()
      .where("email", "=", context.input.email)
      .executeTakeFirstOrThrow();

    await db
      .updateTable("User")
      .set({ age: user.age + 1 })
      .where("id", "=", user.id)
      .execute();

    return { oldAge: user.age, newAge: user.age + 1 };
  },
  output: t.object({ oldAge: t.int(), newAge: t.int() }),
});
```

### Input validation

Validators run before the body. Each receives `{ value, data, user }`.

```typescript
export default createResolver({
  name: "createUser",
  operation: "mutation",
  input: {
    email: t
      .string()
      .validate(
        ({ value }) => value.includes("@"),
        [({ value }) => value.length <= 255, "Email must be 255 characters or less"],
      ),
    age: t.int().validate(({ value }) => value >= 0 && value <= 150),
  },
  body: (context) => {
    return { email: context.input.email };
  },
  output: t.object({ email: t.string() }),
});
```

### Reusing TailorDB field definitions

```typescript
createResolver({
  name: "updateUser",
  operation: "mutation",
  input: {
    name: user.fields.name,
    email: user.fields.email,
  },
  body: async (context) => {
    /* ... */
  },
  output: t.object({ success: t.bool() }),
});
```

TailorDB-specific options (index, relation, hooks, unique) are silently ignored in resolver schemas.

### Schema field types

`t.string()`, `t.int()`, `t.float()`, `t.bool()`, `t.date()`, `t.datetime()`, `t.uuid()`, `t.enum([...])`, `t.object({...})`

All support: `.description("...")`, `.validate(...)`, `{ optional: true }`, `{ array: true }`

### Event publishing

Omit `publishEvents` — the SDK auto-enables it when an executor uses `resolverExecutedTrigger` on this resolver. Set explicitly only for external consumers or to force-disable.

## Common Mistakes

### CRITICAL Multiple resolvers in one file

Wrong:

```typescript
export default createResolver({ name: "resolverA" /* ... */ });
export const resolverB = createResolver({ name: "resolverB" /* ... */ });
```

Correct:

```typescript
// resolvers/resolverA.ts
export default createResolver({ name: "resolverA" /* ... */ });
// resolvers/resolverB.ts (separate file)
export default createResolver({ name: "resolverB" /* ... */ });
```

The SDK only discovers the single default export per file. The second resolver is silently ignored.

Source: docs/services/resolver.md

### CRITICAL Not using default export

Wrong:

```typescript
export const myResolver = createResolver({ name: "myResolver" /* ... */ });
```

Correct:

```typescript
export default createResolver({ name: "myResolver" /* ... */ });
```

Named exports are not discovered by the bundler.

Source: docs/services/resolver.md

### HIGH TailorDB-specific options in resolver schema

Wrong:

```typescript
input: {
  email: t.string().unique(),
  userId: t.uuid().relation({ type: "n-1", toward: { type: user } }),
}
```

Correct:

```typescript
input: {
  email: t.string().validate(({ value }) => value.includes("@")),
  userId: t.uuid(),
}
```

Options like `.unique()`, `.relation()`, and `.hooks()` are TailorDB-only. They are silently ignored in resolver schemas.

Source: docs/services/resolver.md

### HIGH Wrong getDB namespace name

Wrong:

```typescript
const db = getDB("tailorDB");
```

Correct:

```typescript
const db = getDB("tailordb");
```

The namespace must exactly match the key in `tailor.config.ts`. A typo causes a runtime error.

### MEDIUM Forgetting async/await with getDB

Wrong:

```typescript
body: (context) => {
  const db = getDB("tailordb");
  const result = db.selectFrom("User").selectAll().execute();
  return { users: result };
},
```

Correct:

```typescript
body: async (context) => {
  const db = getDB("tailordb");
  const result = await db.selectFrom("User").selectAll().execute();
  return { users: result };
},
```

Kysely operations return Promises. Missing `await` returns a pending Promise instead of data.

See also: tailor-sdk-tailordb — reuse field definitions via pickFields/omitFields
See also: tailor-sdk-workflow — trigger workflows from resolvers
