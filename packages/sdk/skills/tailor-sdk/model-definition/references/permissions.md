# TailorDB Permission Reference

## Record-level permissions (.permission)

```typescript
.permission({
  create: [conditions],
  read: [conditions],
  update: [conditions],
  delete: [conditions],
})
```

Each action takes an array of condition arrays. Multiple conditions within an action are OR'd. Conditions within a single array are AND'd.

## Condition format

```typescript
[operand, operator, value];
```

### Operands

| Operand                      | Meaning               | Available in                |
| ---------------------------- | --------------------- | --------------------------- |
| `{ user: "fieldName" }`      | User attribute        | .permission, .gqlPermission |
| `{ user: "_loggedIn" }`      | User is authenticated | .permission, .gqlPermission |
| `{ record: "fieldName" }`    | Current record field  | .permission only            |
| `{ newRecord: "fieldName" }` | Record after update   | .permission (update only)   |
| `{ oldRecord: "fieldName" }` | Record before update  | .permission (update only)   |

### Operators

| Operator       | Meaning                  |
| -------------- | ------------------------ |
| `"="`          | Equals                   |
| `"!="`         | Not equals               |
| `"in"`         | Value in array           |
| `"not in"`     | Value not in array       |
| `"hasAny"`     | Array has any of values  |
| `"not hasAny"` | Array has none of values |

## GraphQL-level permissions (.gqlPermission)

```typescript
.gqlPermission([{
  conditions: [[{ user: "role" }, "=", "ADMIN"]],
  actions: ["read", "create", "update", "delete", "aggregate", "bulkUpsert"],
  permit: true,  // default true; set false to deny
}])
```

gqlPermission ONLY supports `{user: field}` operands. Do NOT use `{record: field}`, `{newRecord: field}`, or `{oldRecord: field}` — they silently fail.

## Available actions (gqlPermission)

`"read"`, `"create"`, `"update"`, `"delete"`, `"aggregate"`, `"bulkUpsert"`, `"all"`

## Examples

```typescript
// Logged-in users can read; admins can do everything
.permission({
  create: [[{ user: "role" }, "=", "ADMIN"]],
  read: [[{ user: "_loggedIn" }, "=", true]],
  update: [
    [{ user: "role" }, "=", "ADMIN"],
    [{ record: "ownerId" }, "=", { user: "id" }],  // OR own records
  ],
  delete: [[{ user: "role" }, "=", "ADMIN"]],
})
.gqlPermission([
  {
    conditions: [[{ user: "role" }, "=", "ADMIN"]],
    actions: ["all"],
  },
  {
    conditions: [[{ user: "_loggedIn" }, "=", true]],
    actions: ["read", "create"],
  },
])
```

## Development-only unsafe permissions

```typescript
import { unsafeAllowAllTypePermission, unsafeAllowAllGqlPermission } from "@tailor-platform/sdk";

db.type("Dev", { ... })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
```

These allow all operations without auth. Never use in production.
