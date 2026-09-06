---
"@tailor-platform/sdk": patch
---

Reject TailorDB enum fields that define no allowed values when the configuration is parsed. `tailor deploy` now reports the field instead of sending it to the platform, and `tailor tailordb migration generate` reports it instead of producing migration code that cannot typecheck.
