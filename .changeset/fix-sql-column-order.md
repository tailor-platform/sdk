---
"@tailor-platform/sdk": patch
---

Fix column ordering in SQL wildcard query results by sorting columns based on db.type() field definition order. Wildcards are expanded in-place preserving SQL declaration order, with system fields (id) first followed by user-defined fields. Supports both unqualified (`SELECT *`) and qualified (`SELECT u.*`) wildcards with alias resolution. Column matching is case-insensitive to handle unquoted SQL identifiers correctly.
