---
"@tailor-platform/sdk": patch
---

Fix Kysely type generation for date/datetime fields inside nested objects (db.object()).

- Nested date/datetime fields now generate `string` instead of `Timestamp` (ColumnType), matching the actual runtime behavior where the server returns and accepts ISO 8601 strings for nested datetime fields.
- Nullable fields inside nested objects are now optional (`?`), consistent with how Kysely's `Insertable` treats nullable top-level fields.
- Added `DeepResolveColumnType` to `NamespaceInsertable`/`NamespaceSelectable`/`NamespaceUpdateable` to recursively resolve any `ColumnType` in nested objects as a safety net.
