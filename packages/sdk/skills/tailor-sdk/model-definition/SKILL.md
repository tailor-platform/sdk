---
name: tailor-sdk/model-definition
description: >
  Define TailorDB types with db.type(), db.string(), db.int(), db.uuid(),
  db.enum(), db.object(), db.decimal(). Field modifiers: optional, array,
  index, unique, serial, vector. Relations: n-1, 1-1, keyOnly, self.
  Permissions: .permission() record-level, .gqlPermission() GraphQL-level.
  Hooks: .hooks() create/update. Validation: .validate(). Indexes, files,
  features, db.fields.timestamps().
type: sub-skill
library: tailor-sdk
library_version: "1.25.1"
sources:
  - "tailor-platform/sdk:packages/sdk/docs/services/tailordb.md"
  - "tailor-platform/sdk:packages/sdk/src/configure/services/tailordb/schema.ts"
  - "tailor-platform/sdk:packages/sdk/src/configure/services/tailordb/permission.ts"
---

This skill builds on tailor-sdk. Read tailor-sdk/SKILL.md first for an overview.

# Model Definition

## Setup

Define a TailorDB type and export it:

```typescript
import { db } from "@tailor-platform/sdk";

export const user = db
  .type("User", {
    email: db.string().unique(),
    name: db.string(),
    role: db.enum(["ADMIN", "MANAGER", "STAFF"]),
    bio: db.string({ optional: true }),
    tags: db.string({ optional: true, array: true }),
    ...db.fields.timestamps(),
  })
  .permission({
    create: [[{ user: "role" }, "=", "ADMIN"]],
    read: [[{ user: "_loggedIn" }, "=", true]],
    update: [[{ record: "id" }, "=", { user: "id" }]],
    delete: [[{ user: "role" }, "=", "ADMIN"]],
  })
  .gqlPermission([
    {
      conditions: [[{ user: "_loggedIn" }, "=", true]],
      actions: ["read", "create"],
    },
  ]);

export type user = typeof user;
```

## Core Patterns

### Relations

```typescript
import { db } from "@tailor-platform/sdk";
import type { customer } from "./customer";

export const order = db.type("Order", {
  customerId: db.uuid().relation({ type: "n-1", toward: { type: customer } }),
  approvedById: db
    .uuid({ optional: true })
    .relation({ type: "n-1", toward: { type: user, as: "approver" } }),
  parentOrderId: db.uuid({ optional: true }).relation({ type: "n-1", toward: { type: "self" } }),
  ...db.fields.timestamps(),
});
```

Relation types: `"n-1"` (many-to-one), `"1-1"` (one-to-one, auto-adds unique+index), `"keyOnly"` (foreign key without GraphQL traversal).

### Hooks for computed fields

```typescript
export const invoice = db
  .type("Invoice", {
    invoiceNumber: db.string().serial({ start: 1, format: "INV-{value}" }),
    total: db.int(),
    ...db.fields.timestamps(),
  })
  .hooks({
    total: {
      create: ({ data }) => data.quantity * data.unitPrice,
      update: ({ data }) => data.quantity * data.unitPrice,
    },
  });
```

### Validation

```typescript
export const product = db.type("Product", {
  price: db.int().validate([({ value }) => value > 0, "Price must be positive"]),
  sku: db
    .string()
    .validate([({ value }) => /^[A-Z]{3}-\d{4}$/.test(value), "SKU must match format AAA-0000"]),
});
```

Validators receive `{ value, data, user }`. Must be pure synchronous functions — no async, no external calls.

### Nested objects and enums

```typescript
export const event = db.type("Event", {
  status: db.enum([{ value: "draft", description: "Not yet published" }, "published", "archived"]),
  metadata: db.object(
    {
      source: db.string(),
      priority: db.int({ optional: true }),
    },
    { optional: true },
  ),
  addresses: db.object(
    {
      street: db.string(),
      city: db.string(),
    },
    { array: true },
  ),
});
```

## Common Mistakes

### CRITICAL Using fluent .optional() instead of constructor option

Wrong:

```typescript
db.type("Product", {
  description: db.string().optional(),
  tags: db.string().array(),
});
```

Correct:

```typescript
db.type("Product", {
  description: db.string({ optional: true }),
  tags: db.string({ array: true }),
});
```

optional and array are constructor options, not fluent methods. `.optional()` and `.array()` do not exist on db fields. This is the most common AI-agent mistake.

Source: maintainer interview

### CRITICAL Forgetting default-deny permission model

Wrong:

```typescript
export const product = db.type("Product", {
  name: db.string(),
  price: db.int(),
});
```

Correct:

```typescript
export const product = db
  .type("Product", {
    name: db.string(),
    price: db.int(),
  })
  .permission({
    create: [[{ user: "role" }, "=", "ADMIN"]],
    read: [[{ user: "_loggedIn" }, "=", true]],
    update: [[{ user: "role" }, "=", "ADMIN"]],
    delete: [[{ user: "role" }, "=", "ADMIN"]],
  })
  .gqlPermission([
    {
      conditions: [[{ user: "_loggedIn" }, "=", true]],
      actions: ["read"],
    },
  ]);
```

All permissions default to deny. A type without .permission() and .gqlPermission() is inaccessible via API.

Source: docs/services/tailordb.md

### CRITICAL Using record/newRecord/oldRecord in gqlPermission

Wrong:

```typescript
.gqlPermission([{
  conditions: [[{ record: "ownerId" }, "=", { user: "id" }]],
  actions: ["read"],
}])
```

Correct:

```typescript
// gqlPermission only supports {user: field} operand
.gqlPermission([{
  conditions: [[{ user: "role" }, "=", "ADMIN"]],
  actions: ["read"],
}])
// Use .permission() for record-level conditions
.permission({
  read: [[{ record: "ownerId" }, "=", { user: "id" }]],
})
```

gqlPermission only supports the `{user: field}` operand. `{record: field}`, `{newRecord: field}`, `{oldRecord: field}` silently compile but fail at runtime. Use .permission() for record-level access control.

Source: docs/services/tailordb.md

### HIGH Defining an id field manually

Wrong:

```typescript
db.type("User", {
  id: db.uuid(),
  name: db.string(),
});
```

Correct:

```typescript
db.type("User", {
  name: db.string(),
});
```

Every db.type() automatically adds an `id: uuid()` field. Defining it manually causes a duplicate field error.

Source: packages/sdk/src/configure/services/tailordb/schema.ts

### HIGH Applying .index() or .unique() to array fields

Wrong:

```typescript
db.type("Article", {
  tags: db.string({ array: true }).unique(),
});
```

Correct:

```typescript
db.type("Article", {
  tags: db.string({ array: true }),
});
```

Array fields cannot have index or unique constraints. The SDK throws at parse time.

Source: packages/sdk/src/configure/services/tailordb/schema.ts

### HIGH Mixing field-level and type-level hooks on same field

Hooks can be defined on the field directly or via .hooks() on the type, but not both for the same field. This causes a compile error.

Source: docs/services/tailordb.md

### HIGH Async or complex logic in condition/validate/hooks

Wrong:

```typescript
db.type("Order", {
  total: db.int().validate(async ({ value }) => {
    const limit = await fetchLimit();
    return value < limit;
  }),
});
```

Correct:

```typescript
db.type("Order", {
  total: db.int().validate([({ value }) => value > 0, "Total must be positive"]),
});
```

condition, validate, and hooks are pure synchronous functions. No async, no external calls, no complex logic. Handle complex validation in resolver/executor function bodies.

Source: maintainer interview

### HIGH Tension: Default-deny security vs getting-started simplicity

Permissions default to deny-all, making first models inaccessible. When prototyping, use `unsafeAllowAllTypePermission` and `unsafeAllowAllGqlPermission` (development only), then replace with proper permissions before production.

See also: tailor-sdk/quickstart/SKILL.md § Common Mistakes

## References

- [Field types and modifiers](references/field-types.md)
- [Permission condition reference](references/permissions.md)

See also: tailor-sdk/code-generation/SKILL.md — generated types reflect model structure
See also: tailor-sdk/configuration/SKILL.md — auth.userProfile references a TailorDB type
