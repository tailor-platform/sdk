---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-seed": patch
---

A relation on a field inside `db.object()` that points at its own table, such as `links.parentID` on `Node`, now works with `tailor seed apply` and with the data copy of a table rename. Seed rows are inserted parent first, including when the reference sits inside a nested array, and a rename copy inserts the reference as null and restores it once every row exists. The rename copy now restores the references with one update per row instead of a single update with a subselect, which the platform rejects; this also fixes the copy of a table that has a self-reference on a top-level field. A table whose self-referential foreign key inside a nested field is required is no longer detected as a rename, because the copy cannot insert such a row before its parent.
