---
"@tailor-platform/sdk": patch
---

Share the set of `ColumnType`-shaped column aliases between the Kysely type plugin and the migration type generator, so both stay in agreement on which array types need `ArrayColumnType`. Generated types are unchanged.
