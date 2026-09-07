---
"@tailor-platform/sdk": patch
---

Reject TailorDB enum fields that define no allowed values. `tailor deploy` and `tailor tailordb migration generate` now report an error identifying the table and field.
