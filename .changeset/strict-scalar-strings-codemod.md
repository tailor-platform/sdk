---
"@tailor-platform/sdk-codemod": minor
---

Add the `v2/strict-scalar-strings` migration entry for the strict UUID/date/datetime/time/decimal field string types. The migration guide now documents the new scalar shapes and `is*String` / `parse*String` / `assert*String` helpers, and the runner flags likely-affected files (`getDB` / `toISOString` / `mockIdp` usage and old `"mock-id"` fixtures) for LLM-assisted review.
