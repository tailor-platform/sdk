---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

The remaining internal comments, JSDoc, and test titles that named a `db.table()` definition a type now say table (table-level hooks, table-attached plugins, table renames, and so on). The only visible change is the plugin error `Plugin "..." does not support table-attached processing`; identifiers and persisted formats are unchanged.
