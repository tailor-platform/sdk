# Resolver

Resolvers are custom GraphQL endpoints with business logic that execute on the Tailor Platform.

## Overview

Resolvers provide:

- Custom GraphQL queries and mutations
- Type-safe input/output schemas
- Access to TailorDB via Kysely query builder
- User context for authentication/authorization

## Comparison with Tailor Platform Pipeline Resolver

The SDK's Resolver is a simplified version of Tailor Platform's [Pipeline Resolver](https://docs.tailor.tech/guides/pipeline).

| Pipeline Resolver                        | SDK Resolver                      |
| ---------------------------------------- | --------------------------------- |
| Multiple steps with different operations | Single `body` function            |
| Declarative step configuration           | Imperative TypeScript code        |
| Built-in TailorDB/GraphQL steps          | Direct database access via Kysely |
| CEL expressions for data transformation  | Native TypeScript transformations |

### Example Comparison

**Pipeline Resolver (Tailor Platform native):**

```yaml
steps:
  - name: getUser
    operation: tailordb.query
    params:
      type: User
      filter:
        email: { eq: "{{ input.email }}" }
  - name: updateAge
    operation: tailordb.mutation
    params:
      type: User
      id: "{{ steps.getUser.id }}"
      input:
        age: "{{ steps.getUser.age + 1 }}"
```

**Resolver (SDK):**

```typescript
createResolver({
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

## Creating a Resolver

Define resolvers in files matching glob patterns specified in `tailor.config.ts`.

```typescript
import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "add",
  operation: "query",
  input: {
    left: t.int(),
    right: t.int(),
  },
  body: (context) => {
    return {
      result: context.input.left + context.input.right,
    };
  },
  output: t.object({
    result: t.int(),
  }),
});
```

## Input/Output Schemas

Define input/output schemas using methods of `t` object. Basic usage and supported field types are the same as TailorDB. TailorDB-specific options (e.g., index, relation) are not supported.

You can reuse fields defined with `db` object, but note that unsupported options will be ignored:

```typescript
const user = db.type("User", {
  name: db.string().unique(),
  age: db.int(),
});

createResolver({
  input: {
    name: user.fields.name,
  },
});
```

## Input Validation

Add validation rules to input fields using the `validate` method:

```typescript
createResolver({
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
    // Input is validated before body executes
    return { email: context.input.email };
  },
  output: t.object({ email: t.string() }),
});
```

Validation functions receive:

- `value` - The field value being validated
- `data` - The entire input object
- `user` - The user performing the operation

You can specify validation as:

- A function returning `boolean` (uses default error message)
- A tuple of `[function, errorMessage]` for custom error messages
- Multiple validators (pass multiple arguments to `validate`)

## Body Function

Define actual resolver logic in the `body` function. Function arguments include:

- `input` - Input data from GraphQL request
- `user` - User performing the operation

### Using Kysely for Database Access

If you're generating Kysely types with a generator, you can use `getDB` to execute typed queries:

```typescript
import { getDB } from "../generated/tailordb";

createResolver({
  name: "getUser",
  operation: "query",
  input: {
    name: t.string(),
  },
  body: async (context) => {
    const db = getDB("tailordb");
    const result = await db
      .selectFrom("User")
      .select("id")
      .where("name", "=", context.input.name)
      .limit(1)
      .executeTakeFirstOrThrow();
    return {
      result: result.id,
    };
  },
  output: t.object({
    result: t.uuid(),
  }),
});
```

## Query vs Mutation

Use `operation: "query"` for read operations and `operation: "mutation"` for write operations:

```typescript
// Query - for reading data
createResolver({
  name: "getUsers",
  operation: "query",
  // ...
});

// Mutation - for creating, updating, or deleting data
createResolver({
  name: "createUser",
  operation: "mutation",
  // ...
});
```
