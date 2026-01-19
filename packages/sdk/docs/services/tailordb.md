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
- **Uniqueness**: Type names must be unique across all TailorDB files

```typescript
import { db } from "@tailor-platform/sdk";

// Export both value and type
export const user = db.type("User", {
  name: db.string(),
  email: db.string().unique(),
  age: db.int(),
  ...db.fields.timestamps(),
});
export type user = typeof user;

// You can define multiple types in the same file
export const role = db.type("Role", {
  name: db.string().unique(),
});
export type role = typeof role;
```

Specify plural form by passing an array as first argument:

```typescript
db.type(["User", "UserList"], {
  name: db.string(),
});
```

Pass a description as second argument:

```typescript
db.type("User", "User in the system", {
  name: db.string(),
});
```

## Field Types

| Method                          | TailorDB | TypeScript     |
| ------------------------------- | -------- | -------------- |
| `db.string()`                   | String   | string         |
| `db.int()`                      | Integer  | number         |
| `db.float()`                    | Float    | number         |
| `db.bool()`                     | Boolean  | boolean        |
| `db.date()`                     | Date     | string         |
| `db.datetime()`                 | DateTime | string \| Date |
| `db.time()`                     | Time     | string         |
| `db.uuid()`                     | UUID     | string         |
| [`db.enum()`](#enum-fields)     | Enum     | string         |
| [`db.object()`](#object-fields) | Nested   | object         |

### Optional and Array Fields

```typescript
db.string({ optional: true });
db.string({ array: true });
db.string({ optional: true, array: true });
```

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
db.object({
  street: db.string(),
  city: db.string(),
  country: db.string(),
});
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
const role = db.type("Role", {
  name: db.string(),
});

const user = db.type("User", {
  name: db.string(),
  roleId: db.uuid().relation({
    type: "n-1",
    toward: { type: role },
  }),
});
```

For one-to-one relations, use `type: "1-1"`:

```typescript
const userProfile = db.type("UserProfile", {
  userId: db.uuid().relation({
    type: "1-1",
    toward: { type: user },
  }),
  bio: db.string(),
});
```

For foreign key constraint without creating a relation, use `type: "keyOnly"`:

```typescript
const user = db.type("User", {
  roleId: db.uuid().relation({
    type: "keyOnly",
    toward: { type: role },
  }),
});
```

Create relations against different fields using `toward.key`:

```typescript
const user = db.type("User", {
  email: db.string().unique(),
});

const userProfile = db.type("UserProfile", {
  userEmail: db.string().relation({
    type: "1-1",
    toward: { type: user, key: "email" },
  }),
});
```

Customize relation names using `toward.as` / `backward` options:

```typescript
const userProfile = db.type("UserProfile", {
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

### Hooks

Add hooks to execute functions during data creation or update. Hooks receive three arguments:

- `value`: User input if provided, otherwise existing value on update or null on create
- `data`: Entire record data (for accessing other field values)
- `user`: User performing the operation

#### Field-level Hooks

Set hooks directly on individual fields:

```typescript
db.string().hooks({
  create: ({ user }) => user.id,
  update: ({ value }) => value,
});
```

**Note:** When setting hooks at the field level, the `data` argument type is `unknown` since the field doesn't know about other fields in the type. Use type-level hooks if you need to access other fields with type safety.

#### Type-level Hooks

Set hooks for multiple fields at once using `db.type().hooks()`:

```typescript
export const customer = db
  .type("Customer", {
    firstName: db.string(),
    lastName: db.string(),
    fullName: db.string(),
  })
  .hooks({
    fullName: {
      create: ({ data }) => `${data.firstName} ${data.lastName}`,
      update: ({ data }) => `${data.firstName} ${data.lastName}`,
    },
  });
```

**⚠️ Important:** Field-level and type-level hooks cannot coexist on the same field. TypeScript will prevent this at compile time:

```typescript
// ❌ Compile error - cannot set hooks on the same field twice
export const user = db
  .type("User", {
    name: db.string().hooks({ create: ({ data }) => data.firstName }), // Field-level
  })
  .hooks({
    name: { create: ({ data }) => data.lastName }, // Type-level - ERROR
  });

// ✅ Correct - set hooks on different fields
export const user = db
  .type("User", {
    firstName: db.string().hooks({ create: () => "John" }), // Field-level on firstName
    lastName: db.string(),
  })
  .hooks({
    lastName: { create: () => "Doe" }, // Type-level on lastName
  });
```

### Validation

Add validation rules to fields. Validators receive three arguments (executed after hooks):

- `value`: Field value after hook transformation
- `data`: Entire record data after hook transformations (for accessing other field values)
- `user`: User performing the operation

Validators return `true` for success, `false` for failure. Use array form `[validator, errorMessage]` for custom error messages.

#### Field-level Validation

Set validators directly on individual fields:

```typescript
db.string().validate(
  ({ value }) => value.includes("@"),
  [({ value }) => value.length >= 5, "Email must be at least 5 characters"],
);
```

#### Type-level Validation

Set validators for multiple fields at once using `db.type().validate()`:

```typescript
export const user = db
  .type("User", {
    name: db.string(),
    email: db.string(),
  })
  .validate({
    name: [({ value }) => value.length > 5, "Name must be longer than 5 characters"],
    email: [
      ({ value }) => value.includes("@"),
      [({ value }) => value.length >= 5, "Email must be at least 5 characters"],
    ],
  });
```

**⚠️ Important:** Field-level and type-level validation cannot coexist on the same field. TypeScript will prevent this at compile time:

```typescript
// ❌ Compile error - cannot set validation on the same field twice
export const user = db
  .type("User", {
    name: db.string().validate(({ value }) => value.length > 0), // Field-level
  })
  .validate({
    name: [({ value }) => value.length < 100, "Too long"], // Type-level - ERROR
  });

// ✅ Correct - set validation on different fields
export const user = db
  .type("User", {
    name: db.string().validate(({ value }) => value.length > 0), // Field-level on name
    email: db.string(),
  })
  .validate({
    email: [({ value }) => value.includes("@"), "Invalid email"], // Type-level on email
  });
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
export const user = db.type("User", {
  name: db.string(),
  ...db.fields.timestamps(),
});
```

## Type Modifiers

### Composite Indexes

```typescript
db.type("User", {
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
db.type("User", {
  name: db.string(),
}).files({
  avatar: "profile image",
});
```

### Features

```typescript
db.type("User", {
  name: db.string(),
}).features({
  aggregation: true,
  bulkUpsert: true,
});
```

### Permissions

Configure Permission and GQLPermission. For details, see the [TailorDB Permission documentation](https://docs.tailor.tech/guides/tailordb/permission).

**Important**: Following the secure-by-default principle, all operations are denied if permissions are not configured. You must explicitly grant permissions for each operation (create, read, update, delete).

```typescript
db.type("User", {
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

db.type("User", {
  name: db.string(),
})
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
```

**Warning**: Do not use `unsafeAllowAllTypePermission` or `unsafeAllowAllGqlPermission` in production environments as they effectively disable authorization checks.
