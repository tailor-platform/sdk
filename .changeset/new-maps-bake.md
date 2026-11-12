---
"@tailor-platform/sdk": major
---

Normalize query error codes to uppercase: `invalid_sql` → `INVALID_SQL`, `invalid_namespace` → `INVALID_NAMESPACE`, and `not_found` → `MACHINE_USER_NOT_FOUND`. Update scripts that compare these codes to use the uppercase values.
