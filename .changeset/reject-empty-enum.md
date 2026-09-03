---
"@tailor-platform/sdk": patch
---

Reject TailorDB enum fields that define no allowed values when the configuration is parsed, so `tailor apply` and `tailor tailordb migration generate` report the field instead of producing migration code that cannot typecheck.
