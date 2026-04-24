# Resolver

Resolvers are custom GraphQL endpoints with business logic that execute on the Tailor Platform.

## Overview

Resolvers provide:

- Custom GraphQL queries and mutations
- Type-safe input/output schemas
- Access to TailorDB via Kysely query builder
- User context for authentication/authorization

## Comparison with Tailor Platform Pipeline Resolver

The SDK's Resolver is a simplified version of Tailor Platform's [Pipeline Resolver](https://docs.tailor.tech/guides/resolver).

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

**Definition Rules:**

- **One resolver per file**: Each file must contain exactly one resolver definition
- **Export method**: Must use `export default`
- **Uniqueness**: Resolver names must be unique per namespace

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

### Custom Type Name (`typeName`)

Enum and nested object fields in input/output schemas generate protobuf type names automatically (e.g., `{ResolverName}{FieldName}`). Use `typeName()` to set a custom name:

```typescript
createResolver({
  name: "createOrder",
  operation: "mutation",
  input: {
    address: t
      .object({
        street: t.string(),
        city: t.string(),
        zip: t.string(),
      })
      .typeName("ShippingAddress"),
    status: t.enum(["pending", "confirmed", "shipped"]).typeName("OrderStatus"),
  },
  // ...
});
```

**Constraints:**

- Only available on `enum()` and `object()` fields — calling on scalar types is a compile error
- Cannot be called twice on the same field
- Can be chained with `description()`

This is useful when the same logical type appears in multiple resolvers or when you want a predictable, human-readable name in the generated GraphQL schema.

**Warning:** Do not set `typeName` to an existing TailorDB type name on an `object()` that contains enum or nested fields. Child fields without an explicit `typeName` auto-generate names using `{parentTypeName}{FieldName}`, which can collide with the TailorDB type's own enum/nested type names.

```typescript
// Collision — "Item" + "status" auto-generates "ItemStatus",
//   which collides with the TailorDB Item type's status enum
output: t
  .object({
    id: t.uuid(),
    status: t.enum(["ACTIVE", "INACTIVE"]),
  })
  .typeName("Item"),

// OK — use a distinct name that won't collide
output: t
  .object({
    id: t.uuid(),
    status: t.enum(["ACTIVE", "INACTIVE"]),
  })
  .typeName("DeactivateItemOutput"),

// OK — explicitly set typeName on child enum too
output: t
  .object({
    id: t.uuid(),
    status: t.enum(["ACTIVE", "INACTIVE"]).typeName("DeactivateItemStatus"),
  })
  .typeName("Item"),
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

Validation runs automatically before the `body` function executes. When validation fails, individual errors are returned in the GraphQL `errors` array with field-level paths:

```json
{
  "errors": [
    {
      "message": "Value must be non-negative",
      "path": ["createUser", "age"]
    }
  ]
}
```

## Body Function

Define actual resolver logic in the `body` function. Function arguments include:

- `input` - Input data from GraphQL request
- `user` - User performing the operation
- `invoker` - Principal running this function, overridden by `authInvoker` when set; `null` for anonymous calls.
- `env` - Environment variables declared in `tailor.config.ts`

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

## Event Publishing

Enable event publishing for a resolver to trigger executors on resolver execution:

```typescript
createResolver({
  name: "processOrder",
  operation: "mutation",
  publishEvents: true,
  // ...
});
```

**Behavior:**

- When `publishEvents: true`, resolver execution events are published
- When not specified, it is **automatically set to `true`** if an executor uses this resolver with `resolverExecutedTrigger`
- When explicitly set to `false` while an executor uses this resolver, an error is thrown during `tailor apply`

**Use cases:**

1. **Auto-detection (recommended)**: Don't set `publishEvents` - the SDK automatically enables it when needed by executors

   ```typescript
   // publishEvents is automatically enabled because an executor uses this resolver
   export default createResolver({
     name: "processPayment",
     operation: "mutation",
     // publishEvents not set - auto-detected
     // ...
   });

   // In executor file:
   export default createExecutor({
     trigger: resolverExecutedTrigger("processPayment"),
     // ...
   });
   ```

2. **Manual enable**: Enable event publishing for external consumers or debugging

   ```typescript
   createResolver({
     name: "auditAction",
     operation: "mutation",
     publishEvents: true, // Enable even without executor triggers
     // ...
   });
   ```

3. **Explicit disable**: Disable event publishing for a resolver that doesn't need it (error if executor uses it)

   ```typescript
   createResolver({
     name: "internalHelper",
     operation: "query",
     publishEvents: false, // Explicitly disable
     // ...
   });
   ```

## Authentication

Specify an `authInvoker` to execute the resolver with machine user credentials. Pass the machine user name as a plain string — it is type-narrowed to the names you defined in your auth config:

```typescript
import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "adminQuery",
  operation: "query",
  output: t.object({ result: t.string() }),
  body: async () => {
    // Executes as "batch-processor" machine user
    return { result: "ok" };
  },
  authInvoker: "batch-processor",
});
```

The machine user name is looked up in the auth service configured on your app (`machineUsers` in `defineAuth`). The namespace is resolved automatically — no need to import `auth` from `tailor.config.ts` in resolver files.

> **Deprecated:** `auth.invoker("batch-processor")` still works, but is deprecated. Importing `auth` into runtime files pulls config-layer (Node-only) dependencies into the bundle.

**Note:** `authInvoker` controls the permissions for database operations and other platform actions. The `user` object passed to `body` still reflects the original caller, while `invoker` reflects the principal actually running the body.
