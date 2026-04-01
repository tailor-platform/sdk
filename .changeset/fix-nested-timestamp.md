---
"@tailor-platform/sdk": patch
---

Fix Kysely type generation for date/datetime fields inside nested objects (`db.object()`).

- Added `ObjectColumnType<T>` helper type that wraps nested objects in `ColumnType`, enabling Kysely's `Insertable`/`Selectable` to correctly expand types for nested fields
- Nested objects containing date/datetime fields now use `ObjectColumnType<{ field: Timestamp; ... }>`, so `Insertable` accepts `Date | string` and `Selectable` returns `Date`
- Nullable fields inside nested objects are now optional (`?`) for inserts, required for selects
