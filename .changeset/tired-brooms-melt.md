---
"@tailor-platform/sdk": patch
---

Fix `tailor deploy`, `tailor tailordb migration resolve`, and `tailor tailordb migration sync` not explaining how to proceed when records with no value for a field block changing it from optional to required.
