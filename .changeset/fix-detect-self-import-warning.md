---
"@tailor-platform/sdk": patch
---

Fix `UNRESOLVED_IMPORT` warning during SDK builds by replacing the self-referential `@tailor-platform/sdk` dynamic import in `function test-run` detection with an alias-based dynamic import
