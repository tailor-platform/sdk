---
"@tailor-platform/sdk": minor
---

Use uppercase, descriptive query error codes: `invalid_sql` → `INVALID_SQL`, `invalid_namespace` → `QUERY_SCHEMA_LOAD_FAILED`, and `not_found` → `MACHINE_USER_NOT_FOUND`. Update scripts that compare these codes to use the new values.
