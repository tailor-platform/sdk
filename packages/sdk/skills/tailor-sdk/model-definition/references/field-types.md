# TailorDB Field Types Reference

## Scalar types

| Constructor     | TypeScript output | Notes                                       |
| --------------- | ----------------- | ------------------------------------------- |
| `db.string()`   | `string`          |                                             |
| `db.int()`      | `number`          | Integer                                     |
| `db.float()`    | `number`          | Floating point                              |
| `db.decimal()`  | `string`          | Arbitrary precision; `scale` option (0-12)  |
| `db.bool()`     | `boolean`         |                                             |
| `db.uuid()`     | `string`          | UUID format validated                       |
| `db.date()`     | `string`          | Format: `yyyy-MM-dd`                        |
| `db.datetime()` | `string`          | Format: ISO 8601 `yyyy-MM-ddTHH:mm:ss.SSSZ` |
| `db.time()`     | `string`          | Format: `HH:mm`                             |

## Complex types

| Constructor         | Notes                                      |
| ------------------- | ------------------------------------------ |
| `db.enum(values)`   | Values: string[] or {value, description}[] |
| `db.object(fields)` | Nested fields object                       |

## Constructor options

All field constructors accept an options object:

```typescript
db.string({ optional: true }); // nullable field
db.string({ array: true }); // array of strings
db.string({ optional: true, array: true }); // nullable array
```

## Field modifiers (fluent methods)

| Method                                   | Effect                      | Constraints                 |
| ---------------------------------------- | --------------------------- | --------------------------- |
| `.description(text)`                     | Field documentation         |                             |
| `.index()`                               | Database index              | Not on array fields         |
| `.unique()`                              | Unique constraint + index   | Not on array fields         |
| `.relation(config)`                      | Foreign key relation        | Only on uuid fields         |
| `.hooks({ create, update })`             | Transform on write          | Not on nested/object fields |
| `.validate(...validators)`               | Validation rules            | Sync functions only         |
| `.serial({ start, format?, maxValue? })` | Auto-increment              |                             |
| `.vector()`                              | Vector search               | String, non-array only      |
| `.clone(options?)`                       | Copy field with new options |                             |

## Relation types

```typescript
// Many-to-one
db.uuid().relation({ type: "n-1", toward: { type: otherType } });

// One-to-one (auto-adds unique + index)
db.uuid().relation({ type: "1-1", toward: { type: otherType } });

// Key-only (no GraphQL traversal)
db.uuid().relation({ type: "keyOnly", toward: { type: otherType } });

// Self-referencing
db.uuid().relation({ type: "n-1", toward: { type: "self" } });

// With alias and backward name
db.uuid().relation({
  type: "n-1",
  toward: { type: otherType, as: "approver" },
  backward: "approvedOrders",
});
```

## Type modifiers

| Method                                                     | Purpose                          |
| ---------------------------------------------------------- | -------------------------------- |
| `.permission(rules)`                                       | Record-level CRUD access control |
| `.gqlPermission(rules)`                                    | GraphQL-level access control     |
| `.hooks({ field: { create, update } })`                    | Type-level hooks by field name   |
| `.validate({ field: [fn, msg] })`                          | Type-level validators by field   |
| `.indexes({ fields, unique?, name? })`                     | Composite indexes                |
| `.files({ field: "description" })`                         | File attachment fields           |
| `.features({ aggregation?, bulkUpsert?, publishEvents? })` | Feature flags                    |
| `.description(text)`                                       | Type documentation               |
| `.plugin(config)`                                          | Attach plugin configuration      |

## Helpers

```typescript
db.fields.timestamps()
// Expands to: { createdAt: db.datetime(), updatedAt: db.datetime() }
// with auto-hooks for create/update timestamps

db.type(["User", "Users"], { ... })
// Sets custom plural form for GraphQL

db.type("User", "A registered user", { ... })
// Sets description
```
