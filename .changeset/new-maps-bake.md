---
"@tailor-platform/sdk": patch
---

Normalize query error codes to uppercase: `invalid_sql` → `INVALID_SQL`, `invalid_namespace` → `INVALID_NAMESPACE`, and `not_found` → `NOT_FOUND`. Update scripts that compare these codes to use the uppercase values.
