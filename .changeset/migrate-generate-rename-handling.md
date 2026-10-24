---
"@tailor-platform/sdk": patch
---

Internal refactoring: `tailor tailordb migration generate` now handles field, table, and nested member renames and drops with one shared implementation. Prompts, error messages and codes, and JSON output are unchanged.
