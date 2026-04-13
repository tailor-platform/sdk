---
"@tailor-platform/sdk": patch
---

Silence the `UNRESOLVED_IMPORT` warning emitted during SDK builds by marking the self-referential `@tailor-platform/sdk` dynamic import in `function test-run` detection as external
