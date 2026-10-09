---
"@tailor-platform/sdk": patch
---

`tailor tailordb migration test` no longer fails when the source namespace was deployed without a migration label (for example, before it adopted SDK migrations). Like `tailor deploy`, it treats the namespace as being at migration 0 and tests 0001 onward, provided the namespace's schema matches the 0000 snapshot; otherwise it fails and shows the differences.
