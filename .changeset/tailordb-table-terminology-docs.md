---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/create-sdk": patch
---

Consistently call a TailorDB schema definition a "table" instead of a "type" across the docs, matching the `db.type()` → `db.table()` rename. Also fix three leftover `db.type(...)` code samples in `docs/services/tailordb.md` that should have read `db.table(...)`.
