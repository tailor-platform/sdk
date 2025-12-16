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

```typescript
import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string().unique(),
  age: db.int(),
  ...db.fields.timestamps(),
});
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

| Method          | TailorDB | TypeScript     |
| --------------- | -------- | -------------- |
| `db.string()`   | String   | string         |
| `db.int()`      | Integer  | number         |
| `db.float()`    | Float    | number         |
| `db.bool()`     | Boolean  | boolean        |
| `db.date()`     | Date     | string         |
| `db.datetime()` | DateTime | string \| Date |
| `db.time()`     | Time     | string         |
| `db.uuid()`     | UUID     | string         |
| `db.enum()`     | Enum     | string         |
| `db.object()`   | Nested   | object         |

### Enum Fields

```typescript
db.enum("red", "green", "blue");
db.enum(
  { value: "active", description: "Active status" },
  { value: "inactive", description: "Inactive status" },
);
```

### Object Fields

```typescript
db.object({
  street: db.string(),
  city: db.string(),
  country: db.string(),
});
```

## Optional and Array Fields

```typescript
db.string({ optional: true });
db.string({ array: true });
db.string({ optional: true, array: true });
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

Add hooks to execute functions during data creation or update:

```typescript
db.datetime().hooks({
  create: () => new Date(),
  update: () => new Date(),
});
```

Function arguments include: `value` (field value), `data` (entire record value), `user` (user performing the operation).

### Validation

```typescript
db.string().validate(
  ({ value }) => value.length > 5,
  [
    ({ value }) => value.length < 10,
    "Value must be shorter than 10 characters",
  ],
);
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

```typescript
db.type("User", {
  name: db.string(),
  role: db.enum("admin", "user").index(),
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

Following the secure-by-default principle, all operations are denied if permissions are not configured.
