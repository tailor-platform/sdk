---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

The remaining internal comments, JSDoc, and test titles that named a `db.table()` definition a type now say table (table-level hooks, table-attached plugins, table renames, and so on). Behavior is unchanged; a few internal error messages follow the rename, such as `Plugin "..." does not support table-attached processing`. Identifiers and persisted formats are untouched.
