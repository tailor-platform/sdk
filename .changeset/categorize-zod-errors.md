---
"@tailor-platform/sdk": patch
---

Categorize Zod validation errors using SDK brand symbols: branded values that fail schema validation now throw (indicating a user configuration bug), while non-branded values are silently skipped (unrelated files picked up by glob).
