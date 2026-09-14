---
"@tailor-platform/sdk": patch
---

Keep a table's `hooks()` and `validate()` when a plugin adds fields to it. The extended table lost both, so they were missing from the deployed table.
