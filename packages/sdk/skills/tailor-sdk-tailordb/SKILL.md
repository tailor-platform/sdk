---
name: tailor-sdk-tailordb
description: Use this skill when defining TailorDB types, fields, relations, hooks, validations, permissions, and features using db.type() from @tailor-platform/sdk.
metadata:
  sources:
    - docs/services/tailordb.md
  cross_references:
    - tailor-sdk-resolver
    - tailor-sdk-executor
---

# TailorDB Type Definitions

Define database types with `db.type()` from `@tailor-platform/sdk`. Each type generates a full CRUD GraphQL API automatically.

## Setup

```typescript
import {
  db,
  unsafeAllowAllTypePermission,
  unsafeAllowAllGqlPermission,
} from "@tailor-platform/sdk";
```

## Core Patterns

### Define a type — export both value and type

```typescript
import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string().unique(),
  age: db.int({ optional: true }),
  role: db.enum(["admin", "member"]).index(),
  ...db.fields.timestamps(),
});
export type user = typeof user;
```

### Plural form and description

```typescript
export const category = db.type(["Category", "Categories"], "Product category", {
  name: db.string().unique(),
});
export type category = typeof category;
```

### Field types

| Method          | DB Type  | TS Type          |
| --------------- | -------- | ---------------- |
| `db.string()`   | String   | `string`         |
| `db.int()`      | Integer  | `number`         |
| `db.float()`    | Float    | `number`         |
| `db.bool()`     | Boolean  | `boolean`        |
| `db.date()`     | Date     | `string`         |
| `db.datetime()` | DateTime | `string \| Date` |
| `db.time()`     | Time     | `string`         |
| `db.uuid()`     | UUID     | `string`         |
| `db.enum()`     | Enum     | string literal   |
| `db.object()`   | Nested   | `object`         |

### Field modifiers

```typescript
db.string({ optional: true }); // nullable
db.string({ array: true }); // string[]
db.string().index(); // indexed
db.string().unique(); // unique + indexed
db.string().description("Full name"); // description
db.string().vector(); // vector search (string only, non-array)
```

### Enum fields

```typescript
db.enum(["active", "inactive"]);
db.enum([
  { value: "active", description: "Currently active" },
  { value: "inactive", description: "Deactivated" },
]);
```

### Object (nested) fields

```typescript
db.object({
  street: db.string(),
  city: db.string(),
  zip: db.string(),
});
```

### Relations

```typescript
// Many-to-one
roleId: db.uuid().relation({ type: "n-1", toward: { type: role } }),

// One-to-one
userId: db.uuid().relation({ type: "1-1", toward: { type: user } }),

// Foreign key only (no GraphQL relation)
roleId: db.uuid().relation({ type: "keyOnly", toward: { type: role } }),

// Relation on non-id field
userEmail: db.string().relation({
  type: "1-1",
  toward: { type: user, key: "email" },
}),

// Custom relation names
userId: db.uuid().relation({
  type: "1-1",
  toward: { type: user, as: "base" },
  backward: "profile",
}),
```

### Type-level hooks (preferred when accessing other fields)

```typescript
export const order = db
  .type("Order", {
    subtotal: db.float(),
    tax: db.float(),
    total: db.float(),
  })
  .hooks({
    tax: {
      create: ({ data }) => data.subtotal * 0.1,
      update: ({ data }) => data.subtotal * 0.1,
    },
    total: {
      create: ({ data }) => data.subtotal + data.subtotal * 0.1,
      update: ({ data }) => data.subtotal + data.subtotal * 0.1,
    },
  });
export type order = typeof order;
```

### Field-level hooks (when only the field's own value or user is needed)

```typescript
createdBy: db.uuid().hooks({ create: ({ user }) => user.id }),
```

Note: `data` is typed as `unknown` in field-level hooks because the field has no knowledge of sibling fields. Use type-level hooks when you need typed access to `data`.

### Type-level validation

```typescript
export const user = db
  .type("User", {
    name: db.string(),
    email: db.string(),
  })
  .validate({
    name: [({ value }) => value.length > 0, "Name required"],
    email: [
      ({ value }) => value.includes("@"),
      [({ value }) => value.length >= 5, "Email too short"],
    ],
  });
```

### Permission (deny-by-default)

```typescript
export const post = db
  .type("Post", {
    title: db.string(),
    authorId: db.uuid(),
  })
  .permission({
    create: [[{ user: "_loggedIn" }, "=", true]],
    read: [
      [{ user: "role" }, "=", "admin"],
      [{ record: "authorId" }, "=", { user: "id" }],
    ],
    update: [[{ record: "authorId" }, "=", { user: "id" }]],
    delete: [[{ user: "role" }, "=", "admin"]],
  })
  .gqlPermission([
    { conditions: [[{ user: "role" }, "=", "admin"]], actions: "all" },
    { conditions: [[{ user: "_loggedIn" }, "=", true]], actions: ["read"] },
  ]);
export type post = typeof post;
```

### Features

```typescript
db.type("Order", {
  status: db.string(),
}).features({
  aggregation: true,
  bulkUpsert: true,
  publishEvents: true, // usually omit — auto-detected from executor triggers
});
```

### Composite indexes

```typescript
db.type("UserRole", {
  userId: db.uuid(),
  roleId: db.uuid(),
}).indexes({
  fields: ["userId", "roleId"],
  unique: true,
  name: "user_role_idx",
});
```

### File fields

```typescript
db.type("User", {
  name: db.string(),
}).files({
  avatar: "profile image",
});
```

### Serial (auto-increment)

```typescript
db.int().serial({ start: 0, maxValue: 100 });
db.string().serial({ start: 0, format: "ORD_%d" });
```

### Reuse fields across resolver inputs

```typescript
// In resolver file:
const input = {
  ...user.pickFields(["name", "email"], {}),
};
const partial = user.omitFields(["role"]);
```

## Common Mistakes

### [CRITICAL] Mix field-level and type-level hooks on the same field

Wrong:

```typescript
export const user = db
  .type("User", {
    name: db.string().hooks({ create: () => "default" }),
  })
  .hooks({
    name: { update: ({ data }) => data.name.toUpperCase() },
  });
```

Correct:

```typescript
export const user = db
  .type("User", {
    name: db.string(),
  })
  .hooks({
    name: {
      create: () => "default",
      update: ({ data }) => data.name.toUpperCase(),
    },
  });
```

The type system rejects fields that already carry `.hooks()` from appearing in `.hooks()` at the type level. Place all hooks for a given field at exactly one level.
Source: `src/configure/services/tailordb/schema.ts` line 196 — `this: CurrentDefined extends { hooks: unknown } ? never`

### [CRITICAL] Mix field-level and type-level validation on the same field

Wrong:

```typescript
export const user = db
  .type("User", {
    name: db.string().validate(({ value }) => value.length > 0),
  })
  .validate({
    name: [({ value }) => value.length < 100, "Too long"],
  });
```

Correct:

```typescript
export const user = db
  .type("User", {
    name: db.string(),
    email: db.string(),
  })
  .validate({
    name: [({ value }) => value.length > 0, "Name required"],
    email: [({ value }) => value.includes("@"), "Invalid email"],
  });
```

Same exclusion mechanism as hooks — a field with `.validate()` already set cannot appear in type-level `.validate()`. Pick one level per field.
Source: `src/configure/services/tailordb/schema.ts` line 227 — `this: CurrentDefined extends { validate: unknown } ? never`

### [CRITICAL] Omit permission — all operations silently blocked

Wrong:

```typescript
export const user = db.type("User", {
  name: db.string(),
});
// No .permission() — every create/read/update/delete returns empty or forbidden
```

Correct:

```typescript
export const user = db
  .type("User", {
    name: db.string(),
  })
  .permission({
    create: [[{ user: "_loggedIn" }, "=", true]],
    read: [[{ user: "_loggedIn" }, "=", true]],
    update: [[{ user: "_loggedIn" }, "=", true]],
    delete: [[{ user: "_loggedIn" }, "=", true]],
  })
  .gqlPermission([{ conditions: [[{ user: "_loggedIn" }, "=", true]], actions: "all" }]);
```

TailorDB is deny-by-default. Without `.permission()`, no operation succeeds. There is no error at build time — it only manifests as silent empty responses or access denied at runtime.
Source: `docs/services/tailordb.md` — "all operations are denied if permissions are not configured"

### [HIGH] Manually define an id field

Wrong:

```typescript
export const user = db.type("User", {
  id: db.uuid(), // TypeScript error: id?: never
  name: db.string(),
});
```

Correct:

```typescript
export const user = db.type("User", {
  name: db.string(),
});
// user.fields.id is automatically a UUID field
```

`db.type()` auto-adds an `id: db.uuid()` field. The type signature uses `{ id?: never }` to reject manual id definitions, producing a compile error.
Source: `src/configure/services/tailordb/schema.ts` line 1173 — `type DBType<F extends { id?: never }>`

### [HIGH] .index() or .unique() on an array field

Wrong:

```typescript
tags: db.string({ array: true }).index(),
```

Correct:

```typescript
tags: db.string({ array: true }),
// Use a composite index or separate junction type for indexing array values
```

The type system blocks `.index()` and `.unique()` on array fields via `CurrentDefined extends { array: true } ? never`. The call compiles to `never`, causing a type error.
Source: `src/configure/services/tailordb/schema.ts` lines 160-166

### [HIGH] Hooks on object/nested fields

Wrong:

```typescript
address: db.object({
  street: db.string(),
  city: db.string(),
}).hooks({ create: () => ({ street: "x", city: "y" }) }),
```

Correct:

```typescript
address: db.object({
  street: db.string(),
  city: db.string(),
}),
// Compute nested values in a resolver or workflow instead
```

The `.hooks()` method rejects nested type fields via `CurrentDefined extends { type: "nested" } ? never`. Hooks cannot transform object fields.
Source: `src/configure/services/tailordb/schema.ts` lines 198-199

### [MEDIUM] Manually set publishEvents when auto-detection suffices

Wrong:

```typescript
export const order = db
  .type("Order", {
    status: db.string(),
  })
  .features({ publishEvents: true });

// executor file:
export default createExecutor({
  trigger: recordCreatedTrigger(order),
  // ...
});
```

Correct:

```typescript
export const order = db.type("Order", {
  status: db.string(),
});
// publishEvents is auto-enabled because an executor references this type

// executor file:
export default createExecutor({
  trigger: recordCreatedTrigger(order),
  // ...
});
```

The SDK auto-detects executor record triggers and sets `publishEvents: true` for referenced types. Setting it manually is redundant and creates a maintenance coupling. Only set it explicitly for types consumed by external event subscribers with no executor in the project.
Source: `docs/services/tailordb.md` — "automatically set to true if an executor uses this type"

### [CRITICAL] unsafeAllowAll\*Permission in production

Wrong:

```typescript
import {
  db,
  unsafeAllowAllTypePermission,
  unsafeAllowAllGqlPermission,
} from "@tailor-platform/sdk";

export const invoice = db
  .type("Invoice", { amount: db.float() })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
```

Correct:

```typescript
export const invoice = db
  .type("Invoice", { amount: db.float() })
  .permission({
    create: [[{ user: "role" }, "=", "admin"]],
    read: [[{ user: "_loggedIn" }, "=", true]],
    update: [[{ user: "role" }, "=", "admin"]],
    delete: [[{ user: "role" }, "=", "admin"]],
  })
  .gqlPermission([
    { conditions: [[{ user: "role" }, "=", "admin"]], actions: "all" },
    { conditions: [[{ user: "_loggedIn" }, "=", true]], actions: ["read"] },
  ]);
```

`unsafeAllowAllTypePermission` and `unsafeAllowAllGqlPermission` disable all authorization checks. Use them only in local development and tests. Production deployments must use explicit permission rules.
Source: `docs/services/tailordb.md` — "Do not use unsafeAllowAll\* in production environments"

## Design Tensions

**Deny-by-default security vs development speed (tailordb / auth):** New types have zero permissions. Use `unsafeAllowAll*` during prototyping, then replace with real rules before deploying. Forgetting permissions is the most common cause of "my query returns nothing."

**Auto-detection vs explicit control (tailordb / executor) for publishEvents:** The SDK auto-enables `publishEvents` when an executor uses `recordCreatedTrigger`/`recordUpdatedTrigger`/`recordDeletedTrigger`. Only set it explicitly when external consumers need events without an in-project executor, or set `false` to block event publishing (error if an executor references the type).

## Cross-References

- **tailor-sdk-resolver** — `pickFields()` and `omitFields()` on a TailorDB type produce field subsets for resolver input/output definitions.
- **tailor-sdk-executor** — `recordCreatedTrigger(type)`, `recordUpdatedTrigger(type)`, `recordDeletedTrigger(type)` reference TailorDB types and implicitly enable `publishEvents`.

## References

See `references/tailordb.md` for detailed coverage of field modifiers, serial fields, vector search, decimal fields, and permission patterns.
