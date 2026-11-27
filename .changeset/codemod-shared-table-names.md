---
"@tailor-platform/sdk-codemod": patch
---

`v3/config-to-workspace` no longer asks to rename a TailorDB type name that two merged namespaces repeat. It reports what has to name the namespace instead: record triggers, `userProfile`, and the seed data files. A resolver name that two namespaces repeat is reported as needing `namespace` on its `resolverExecutedTrigger()` calls.
