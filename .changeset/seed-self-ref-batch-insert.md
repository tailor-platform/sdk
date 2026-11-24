---
"@tailor-platform/sdk": patch
---

`tailor seed apply` now inserts rows of a table with a self-referencing foreign key in groups instead of one row at a time. Rows whose parents are all in earlier groups share one INSERT statement (up to 100 rows each), so a table of 408 rows spread over 8 levels takes 8 statements instead of 408. Rows in a cycle, and tables whose self-reference fields are unknown, are still inserted one by one.
