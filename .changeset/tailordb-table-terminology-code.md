---
"@tailor-platform/sdk": patch
---

Rename TailorDB `type` vocabulary to `table` in code, completing the v2 `db.type()` → `db.table()` rename. Record-trigger configs now take `tableName` instead of `typeName`, and `mockFile().calls[]` entries expose `tableName`. Executor runtime args keep `typeName`, which is the payload key the platform sends.
