---
"@tailor-platform/sdk": minor
---

Add `ArrayColumnType<T>` for correct Kysely type resolution in ColumnType arrays

Kysely's `Insertable`/`Selectable` only resolves `ColumnType` at the top-level table property, so `ColumnType[]` (e.g. `Timestamp[]`, `ObjectColumnType<{...}>[]`) was not resolved correctly. `ArrayColumnType<T>` wraps the array inside the `ColumnType` so that insert/select/update types are properly resolved for array fields containing `Timestamp` or `ObjectColumnType`.
