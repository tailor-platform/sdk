---
"@tailor-platform/sdk": patch
---

The config types now describe a `db.table()` definition as a table instead of a type, so editor tooltips match the vocabulary `db.table()` already uses. Hovering `db.table(...).features({ ... })` documents `gqlOperations` and `publishEvents` in terms of a table, `aggregation` and `bulkUpsert` gain the descriptions they were missing, and an executor's record trigger documents `typeName` as "TailorDB table name to watch for events".

`tailordb query` reports an unresolvable name as `Could not find namespace for tables in query: …`.

Field-level descriptions still say type where they mean a field's data type, and the key names themselves are unchanged.
