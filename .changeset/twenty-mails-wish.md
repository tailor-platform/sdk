---
"@tailor-platform/sdk": patch
---

Add an AST-based guard for TailorDB field hooks/validate script that detects references to non-local variables/functions and fails apply when such external dependencies are present.
