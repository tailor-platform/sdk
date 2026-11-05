---
"@tailor-platform/sdk": patch
---

`tailor tailordb migration validate` now also fails, with the error code `tailor deploy` reports, when a pending migration script has no machine user to run it or cannot be bundled
