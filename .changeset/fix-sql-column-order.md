---
"@tailor-platform/sdk": patch
---

Fix column ordering in SQL wildcard query results by sorting columns based on db.type() field definition order. Supports both unqualified (`SELECT *`) and qualified (`SELECT u.*`) wildcards with alias resolution.
