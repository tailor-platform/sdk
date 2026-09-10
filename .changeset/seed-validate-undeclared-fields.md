---
"@tailor-platform/sdk": patch
---

Make `tailor seed validate` reject a seed row that carries a field the table does not declare, at the top level or inside a nested object, instead of passing it through to fail later as a database error in `tailor seed apply`. The issue names the field and how to fix the row.
