---
"@tailor-platform/sdk": patch
---

Fix Kysely type generation for date/datetime fields inside nested objects (`db.object()`).

- Nested objects containing date/datetime fields are now wrapped in `ColumnType<SelectObj, InsertObj, UpdateObj>`, so that `Insertable` accepts `Date | string` while `Selectable` returns `string` — matching actual server behavior.
- Nullable fields inside nested objects are now optional (`?`), consistent with how Kysely's `Insertable` treats nullable top-level fields.
