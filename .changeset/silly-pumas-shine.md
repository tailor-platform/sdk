---
"@tailor-platform/sdk": patch
---

Fix schema snapshot normalization mutating the input snapshot in place, which could cause a caller-held `SchemaSnapshot` reference to silently change after normalization.
