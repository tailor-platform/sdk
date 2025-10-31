---
"@tailor-platform/tailor-sdk": minor
"@tailor-platform/create-tailor-sdk": minor
---

feat!: remove assertNonNull option

## Breaking Changes

### Removed `assertNonNull` option from field definitions

The `assertNonNull` option has been removed from field configurations. This option was previously used with `.hooks()` to ensure fields always return non-null values in resolver outputs, even when marked as `optional: true`.

**Before:**

```typescript
const model = db.type("Model", {
  field: db.string({ optional: true, assertNonNull: true }).hooks({
    create: () => "default-value",
  }),
});
```

**After:**

```typescript
const model = db.type("Model", {
  field: db.string().hooks({
    create: () => "default-value",
  }),
});
```

When you use `.hooks()` with a `create` hook that always provides a value, the field should be defined as non-nullable (without `optional: true`).

### Serial fields must be non-nullable

The `.serial()` method can now only be used on non-nullable fields. If you were using `serial()` with `optional: true`, you must remove the `optional: true` option.

**Before:**

```typescript
const invoice = db.type("Invoice", {
  invoiceNumber: db.string({ optional: true }).serial({
    start: 1000,
    format: "INV-%05d",
  }),
});
```

**After:**

```typescript
const invoice = db.type("Invoice", {
  invoiceNumber: db.string().serial({
    start: 1000,
    format: "INV-%05d",
  }),
});
```

### Hook function argument types

The `data` parameter in hook functions now treats all fields as optional (`T | null | undefined`), regardless of whether they are required in the schema.

**Before:**

```typescript
fullAddress: db.string({ optional: true }).hooks({
  create: ({ data }) => `〒${data.postalCode} ${data.address} ${data.city}`,
  // data.postalCode was guaranteed to be present
});
```

**After:**

```typescript
fullAddress: db.string({ optional: true }).hooks({
  create: ({ data }) =>
    `〒${data.postalCode ?? ""} ${data.address ?? ""} ${data.city ?? ""}`,
  // All fields may be undefined - use ?? or add null checks
});
```
