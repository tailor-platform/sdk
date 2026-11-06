---
"@tailor-platform/sdk": patch
---

`tailor query --engine sql` and `query()` from `@tailor-platform/sdk/cli` now report how many rows an `INSERT`, `UPDATE`, or `DELETE` changed. For these statements the result adds `affectedRows` and sets `rowCount` to the same count, which was 0 when the statement had no `RETURNING`. When such a statement returns no rows, the text output prints the count (for example "3 rows affected.") instead of "No rows returned."
