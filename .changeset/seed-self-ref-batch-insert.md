---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-seed": patch
---

`tailor seed apply` now inserts rows of a table with a self-referencing foreign key in groups instead of one row at a time. Rows whose parents are all in earlier groups share one INSERT statement (up to 100 rows each), so rows spread over a few levels take a handful of statements instead of one per row. Rows in a cycle, tables with missing or duplicate ids, and tables whose self-reference fields are unknown are still inserted one by one.
