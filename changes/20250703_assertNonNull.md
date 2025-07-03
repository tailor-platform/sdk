# assertNonNull Field Modifier

## Overview

The `optional({ assertNonNull: true })` parameter allows you to mark optional fields as non-null in TypeScript type generation, while keeping them nullable in SDL. This addresses the common scenario where SDL requires a field to be nullable, but you want to treat it as non-null in your TypeScript code.

## Problem Solved

Previously, fields like `createdAt` had to be nullable in SDL but were hardcoded as non-null in TypeScript. This created inflexibility and special-case handling. The `optional({ assertNonNull: true })` parameter provides a general solution for any field type.

## Usage

### Basic Example

```typescript
const user = t.type({
  name: t.string(), // required: non-null
  email: t.string().optional(), // optional: nullable
  phone: t.string().optional({ assertNonNull: true }), // optional but non-null in TS
});

// Generated TypeScript interface:
interface User {
  name: string;
  email: string | null;
  phone: string; // <- non-null due to assertNonNull
}
```

### Timestamp Fields

```typescript
const post = t.type({
  title: t.string(),
  createdAt: t.datetime().optional({ assertNonNull: true }), // SDL nullable, TS non-null
  updatedAt: t.datetime().optional(), // SDL nullable, TS nullable
});

// Generated TypeScript interface:
interface Post {
  title: string;
  createdAt: Timestamp; // <- non-null due to assertNonNull
  updatedAt: Timestamp | null;
}
```

### Multiple Field Types

```typescript
const product = t.type({
  name: t.string(),
  price: t.float().optional({ assertNonNull: true }),
  category: t.enum(["electronics", "books"]).optional(),
  tags: t.string().array().optional({ assertNonNull: true }),
  metadata: t
    .object({
      version: t.int(),
    })
    .optional({ assertNonNull: true }),
});

// Generated TypeScript interface:
interface Product {
  name: string;
  price: number; // <- non-null
  category: "electronics" | "books" | null;
  tags: string[]; // <- non-null array
  metadata: { version: number }; // <- non-null object
}
```

## Method Chaining

The `optional({ assertNonNull: true })` parameter can be used with other modifiers:

```typescript
// Various combinations
t.string().optional({ assertNonNull: true });
t.string().optional({ assertNonNull: true }).description("Always has a value");
t.string().array().optional({ assertNonNull: true }); // Non-null array
t.enum(["a", "b"])
  .optional({ assertNonNull: true })
  .description("Required enum");
```

## Supported Field Types

`optional({ assertNonNull: true })` works with all field types:

- `t.string().optional({ assertNonNull: true })`
- `t.int().optional({ assertNonNull: true })`
- `t.float().optional({ assertNonNull: true })`
- `t.bool().optional({ assertNonNull: true })`
- `t.uuid().optional({ assertNonNull: true })`
- `t.date().optional({ assertNonNull: true })`
- `t.datetime().optional({ assertNonNull: true })`
- `t.enum([...]).optional({ assertNonNull: true })`
- `t.object({...}).optional({ assertNonNull: true })`

## Implementation Details

- Adds `assertNonNull?: boolean` to `FieldMetadata` interface
- Updates Kysely type processor to respect the `assertNonNull` flag
- Removes hardcoded special handling of `createdAt`/`updatedAt` fields
- Maintains full backward compatibility

## Backward Compatibility

This change is fully backward compatible. Existing code will continue to work unchanged. The new `optional({ assertNonNull: true })` parameter is opt-in and only affects fields where it's explicitly used.
