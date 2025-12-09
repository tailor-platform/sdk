---
"@tailor-platform/sdk": patch
---

Add a lint-based guard for TailorDB field hooks/validate scripts that detects references to non-local variables/functions and fails apply when such external dependencies are present.
