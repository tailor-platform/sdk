# TailorDB

TailorDB is a type-safe database service for defining and managing data models on the Tailor Platform.

## Overview

TailorDB provides:

- Type-safe schema definitions using TypeScript
- Automatic GraphQL API generation (CRUD operations)
- Relations between types with automatic index and foreign key constraints
- Permission system for access control
- Field-level hooks and validations

For the official Tailor Platform documentation, see [TailorDB Guide](https://docs.tailor.tech/guides/tailordb/overview).

## Type Definition

Define TailorDB Types in files matching glob patterns specified in `tailor.config.ts`.

**Definition Rules:**

- **Multiple types per file**: You can define multiple TailorDB types in a single file
- **Export method**: Use named exports (`export const`)
- **Export both value and type**: Always export both the runtime value and TypeScript type
- **Uniqueness**: Type names must be unique across all TailorDB namespaces in the application

```typescript
import { db } from "@tailor-platform/sdk";

// Export both value and type
export const user = db.table("User", {
  name: db.string(),
  email: db.string().unique(),
  age: db.int(),
  ...db.fields.timestamps(),
});
export type user = typeof user;

// You can define multiple types in the same file
export const role = db.table("Role", {
  name: db.string().unique(),
});
export type role = typeof role;
```

Specify plural form by passing an array as first argument:

```typescript
db.table(["User", "UserList"], {
  name: db.string(),
});
```

Pass a description as second argument:

```typescript
db.table("User", "User in the system", {
  name: db.string(),
});
```

## Field Types

| Method                            | TailorDB | TypeScript     |
| --------------------------------- | -------- | -------------- |
| `db.string()`                     | String   | string         |
| `db.int()`                        | Integer  | number         |
| `db.float()`                      | Float    | number         |
| [`db.decimal()`](#decimal-fields) | Decimal  | string         |
| `db.bool()`                       | Boolean  | boolean        |
| `db.date()`                       | Date     | string         |
| `db.datetime()`                   | DateTime | string \| Date |
| `db.time()`                       | Time     | string         |
| `db.uuid()`                       | UUID     | string         |
| [`db.enum()`](#enum-fields)       | Enum     | string         |
| [`db.object()`](#object-fields)   | Nested   | object         |

### Optional and Array Fields

```typescript
db.string({ optional: true });
db.string({ array: true });
db.string({ optional: true, array: true });
```

### Decimal Fields

Decimal fields are stored as strings to preserve precision. The optional `scale`
parameter sets the number of digits after the decimal point and must be an
integer between 0 and 12. When `scale` is omitted, the platform default of 6 is
used.

```typescript
// Default scale (6 decimal places)
db.decimal();

// Custom scale (2 decimal places)
db.decimal({ scale: 2 });

// Optional with custom scale
db.decimal({ scale: 4, optional: true });
```

Values are rounded half-up to fit the configured scale before being stored.
Negative values follow the same rule based on absolute magnitude:

| Input         | Scale | Stored       |
| ------------- | ----- | ------------ |
| `"1.234"`     | 2     | `"1.23"`     |
| `"1.235"`     | 2     | `"1.24"`     |
| `"-1.235"`    | 2     | `"-1.24"`    |
| `"1.5"`       | 0     | `"2"`        |
| `"1.123456"`  | 6     | `"1.123456"` |
| `"1.1234567"` | 6     | `"1.123457"` |

### Enum Fields

```typescript
db.enum(["red", "green", "blue"]);
db.enum([
  { value: "active", description: "Active status" },
  { value: "inactive", description: "Inactive status" },
]);
```

### Object Fields

```typescript
// Object field
db.object({
  street: db.string(),
  city: db.string(),
  country: db.string(),
});

// Object array field
db.object(
  {
    id: db.uuid(),
    name: db.string(),
    size: db.int(),
  },
  { array: true },
);

// Optional object array field
db.object(
  {
    kind: db.string(),
    days: db.int(),
  },
  { optional: true, array: true },
);
```

## Field Modifiers

### Description

```typescript
db.string().description("User's full name");
```

### Index / Unique

```typescript
db.string().index();
db.string().unique();
```

### Relations

Add a relation to field with automatic index and foreign key constraint:

```typescript
const role = db.table("Role", {
  name: db.string(),
});

const user = db.table("User", {
  name: db.string(),
  roleId: db.uuid().relation({
    type: "n-1",
    toward: { type: role },
  }),
});
```

For one-to-one relations, use `type: "1-1"`:

```typescript
const userProfile = db.table("UserProfile", {
  userId: db.uuid().relation({
    type: "1-1",
    toward: { type: user },
  }),
  bio: db.string(),
});
```

For foreign key constraint without creating a relation, use `type: "keyOnly"`:

```typescript
const user = db.table("User", {
  roleId: db.uuid().relation({
    type: "keyOnly",
    toward: { type: role },
  }),
});
```

Create relations against different fields using `toward.key`:

```typescript
const user = db.table("User", {
  email: db.string().unique(),
});

const userProfile = db.table("UserProfile", {
  userEmail: db.string().relation({
    type: "1-1",
    toward: { type: user, key: "email" },
  }),
});
```

Customize relation names using `toward.as` / `backward` options:

```typescript
const userProfile = db.table("UserProfile", {
  userId: db.uuid().relation({
    type: "1-1",
    toward: { type: user, as: "base" },
    backward: "profile",
  }),
});
```

This generates the following GraphQL types:

```graphql
type UserProfile {
  userId: ID!
  base: User # toward.as: access User from UserProfile
}

type User {
  id: ID!
  profile: UserProfile # backward: access UserProfile from User
}
```

- `toward.as` - Customizes the field name for accessing the related type from this type
- `backward` - Customizes the field name for accessing this type from the related type

Relation names share the same GraphQL field namespace as fields, files, and other relations on
the type. The SDK rejects duplicate or empty relation names. Use `toward.as` when multiple fields
on the same type point to the same target type, because their default forward names are derived
from the target type name:

```typescript
const post = db.table("Post", {
  authorID: db.uuid().relation({
    type: "n-1",
    toward: { type: user, as: "author" },
    backward: "authoredPosts",
  }),
  reviewerID: db.uuid().relation({
    type: "n-1",
    toward: { type: user, as: "reviewer" },
    backward: "reviewedPosts",
  }),
});
```

Use `toward.as` or `backward` when a generated relation name would conflict with an existing
field, files entry, or relation on the same type.

### Hooks

Add hooks to execute functions during data creation or update.

#### Field-level Hooks

Set hooks directly on individual fields.

Create hooks receive:

- `value`: The field value from the input (null when not provided)
- `invoker`: Principal performing the operation
- `now`: Operation timestamp (`Date`), shared across all hooks in the same operation

Update hooks receive the same arguments plus:

- `oldValue`: The previous field value (may be null)

```typescript
db.string().hooks({
  create: ({ invoker }) => invoker?.id ?? "",
  update: ({ value, oldValue }) => value ?? oldValue,
});
```

Field-level hooks operate on a single field and cannot access other fields. Use type-level hooks for cross-field logic.

#### Type-level Hooks

Set hooks across multiple fields using `db.table().hooks()`. The hook returns an object with the fields to override.

Create hooks receive:

- `input`: The submitted record data (pre-hook values)
- `invoker`: Principal performing the operation
- `now`: Operation timestamp (`Date`), shared across all hooks in the same operation

Update hooks receive the same arguments plus:

- `oldRecord`: The existing record (non-null)

```typescript
export const customer = db
  .table("Customer", {
    firstName: db.string(),
    lastName: db.string(),
    fullName: db.string(),
  })
  .hooks({
    create: ({ input }) => ({
      fullName: `${input.firstName} ${input.lastName}`,
    }),
    update: ({ input, oldRecord }) => ({
      fullName: `${input.firstName} ${input.lastName}`,
    }),
  });
```

Use `now` to stamp several fields with the exact same instant:

```typescript
export const order = db
  .table("Order", {
    createdAt: db.datetime(),
    updatedAt: db.datetime(),
  })
  .hooks({
    create: ({ now }) => ({ createdAt: now, updatedAt: now }),
    update: ({ now }) => ({ updatedAt: now }),
  });
```

### Validation

Add validation rules to fields. Validators run after hooks.

#### Field-level Validation

Set validators directly on individual fields. Each validator receives `{ value }` (the field value after hooks) and returns an error message string to fail, or void to pass:

```typescript
db.string().validate(
  ({ value }) => (value.includes("@") ? undefined : "Must contain @"),
  ({ value }) => (value.length >= 5 ? undefined : "Must be at least 5 characters"),
);
```

#### Type-level Validation

Set a validator across all fields using `db.table().validate()`. The validator receives `{ newRecord, oldRecord, invoker }` and an `issues()` callback to report errors per field:

```typescript
export const user = db
  .table("User", {
    name: db.string(),
    email: db.string(),
  })
  .validate(({ newRecord }, issues) => {
    if (newRecord.name.length <= 5) {
      issues("name", "Name must be longer than 5 characters");
    }
    if (!newRecord.email.includes("@")) {
      issues("email", "Must contain @");
    }
  });
```

### Defaults

Set a default value for a required field on create. The field becomes optional in the create input — the default fills in when no value is provided:

```typescript
db.int().default(0);
db.string().default("pending");
```

For datetime/date/time fields, pass `"now"` to use the operation timestamp:

```typescript
db.datetime().default("now");
```

### Vector Search

```typescript
db.string().vector();
```

### Serial / Auto-increment

```typescript
db.int().serial({
  start: 0,
  maxValue: 100,
});

db.string().serial({
  start: 0,
  format: "CUST_%d",
});
```

### Common Fields

```typescript
export const user = db.table("User", {
  name: db.string(),
  ...db.fields.timestamps(),
});
```

`db.fields.timestamps()` adds non-null `createdAt` and `updatedAt` datetime fields. Both fields are populated when a record is created; provided values are preserved so seed data can use historical timestamps. `updatedAt` is also refreshed automatically when a record is updated.

## Type Modifiers

### Composite Indexes

```typescript
db.table("User", {
  firstName: db.string(),
  lastName: db.string(),
}).indexes({
  fields: ["firstName", "lastName"],
  unique: true,
  name: "user_name_idx",
});
```

### File Fields

```typescript
db.table("User", {
  name: db.string(),
}).files({
  avatar: "profile image",
});
```

### Features

```typescript
db.table("User", {
  name: db.string(),
}).features({
  aggregation: true,
  bulkUpsert: true,
});
```

#### Event Publishing

Enable event publishing for a type to trigger executors on record changes:

```typescript
db.table("User", {
  name: db.string(),
}).features({
  publishEvents: true,
});
```

**Behavior:**

- When `publishEvents: true`, record creation/update/deletion events are published
- When not specified, it is **automatically set to `true`** if an executor uses this type with `recordCreatedTrigger`, `recordUpdatedTrigger`, or `recordDeletedTrigger`
- When explicitly set to `false` while an executor uses this type, an error is thrown during `tailor deploy`

**Use cases:**

1. **Auto-detection (recommended)**: Don't set `publishEvents` - the SDK automatically enables it when needed by executors

   ```typescript
   // publishEvents is automatically enabled because an executor uses this type
   export const order = db.table("Order", {
     status: db.string(),
   });

   // In executor file:
   export default createExecutor({
     trigger: recordCreatedTrigger(order),
     // ...
   });
   ```

2. **Manual enable**: Enable event publishing for external consumers or debugging

   ```typescript
   db.table("AuditLog", {
     action: db.string(),
   }).features({
     publishEvents: true, // Enable even without executor triggers
   });
   ```

3. **Explicit disable**: Disable event publishing for a type that doesn't need it (error if executor uses it)

   ```typescript
   db.table("TempData", {
     data: db.string(),
   }).features({
     publishEvents: false, // Explicitly disable
   });
   ```

### Field Extraction (`pickFields` / `omitFields`)

Extract subsets of fields from a `TailorDBType` for reuse in resolvers, executors, seed schemas, etc.

#### `pickFields(keys, options)`

Select specific fields and optionally modify their properties:

```typescript
const user = db.table("User", {
  id: db.uuid(),
  name: db.string(),
  email: db.string().unique(),
  ...db.fields.timestamps(),
});

// Pick id, createdAt, and updatedAt, making them optional
user.pickFields(["id", "createdAt", "updatedAt"], { optional: true });
```

Available options:

| Option     | Effect                                |
| ---------- | ------------------------------------- |
| `optional` | Makes the selected fields optional    |
| `array`    | Makes the selected fields array types |

#### `omitFields(keys)`

Return all fields except the specified ones:

```typescript
// All fields except id, createdAt, and updatedAt
user.omitFields(["id", "createdAt", "updatedAt"]);
```

#### Common Pattern: Input Schema Composition

The typical use case is combining `pickFields` and `omitFields` with spread syntax to build input schemas where identifiers are optional but other fields remain required:

```typescript
import { createResolver, t } from "@tailor-platform/sdk";
import { user } from "../tailordb/user";

export default createResolver({
  name: "createUser",
  operation: "mutation",
  input: {
    // id/createdAt/updatedAt are optional (auto-generated), other fields are required
    ...user.pickFields(["id", "createdAt", "updatedAt"], { optional: true }),
    ...user.omitFields(["id", "createdAt", "updatedAt"]),
  },
  output: t.object({ id: t.uuid() }),
  body: async (context) => {
    // ...
    return { id: "..." };
  },
});
```

This is also used in seed data schemas:

```typescript
import { t } from "@tailor-platform/sdk";
import { invoice } from "../../tailordb/invoice";

const schemaType = t.object({
  ...invoice.pickFields(["id", "createdAt", "updatedAt"], { optional: true }),
  ...invoice.omitFields(["id", "createdAt", "updatedAt", "invoiceNumber", "sequentialId"]),
});
```

### Permissions

Configure Permission and GQLPermission. For details, see the [TailorDB Permission documentation](https://docs.tailor.tech/guides/tailordb/permission).

**Important**: Following the secure-by-default principle, all operations are denied if permissions are not configured. You must explicitly grant permissions for each operation (create, read, update, delete).

```typescript
db.table("User", {
  name: db.string(),
  role: db.enum(["admin", "user"]).index(),
})
  .permission({
    create: [[{ user: "role" }, "=", "admin"]],
    read: [
      [{ user: "role" }, "=", "admin"],
      [{ record: "id" }, "=", { user: "id" }],
    ],
    update: [[{ user: "role" }, "=", "admin"]],
    delete: [[{ user: "role" }, "=", "admin"]],
  })
  .gqlPermission([
    { conditions: [[{ user: "role" }, "=", "admin"]], actions: "all" },
    { conditions: [[{ user: "role" }, "=", "user"]], actions: ["read"] },
  ]);
```

#### Development/Test Helpers

For local development, prototyping, or testing, the SDK provides helper constants that grant full access without conditions:

```typescript
import {
  db,
  unsafeAllowAllTypePermission,
  unsafeAllowAllGqlPermission,
} from "@tailor-platform/sdk";

db.table("User", {
  name: db.string(),
})
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
```

**Warning**: Do not use `unsafeAllowAllTypePermission` or `unsafeAllowAllGqlPermission` in production environments as they effectively disable authorization checks.

## Migrations

When you change a TailorDB type definition, the SDK can generate a migration that captures the diff and, for breaking changes, runs a data transformation script during `tailor deploy`. See the [TailorDB Migrations guide](./tailordb-migration.md) for the full workflow, configuration, supported change types, team coordination, and troubleshooting.

For the CLI command reference, see [`tailordb migration`](../cli/tailordb.md#tailordb-migration).
