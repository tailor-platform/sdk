---
"@tailor-platform/tailor-sdk": minor
---

Removed unused dbNamespace

Removed dbNamespace option. While this is a breaking change, it should have minimal impact since it's no longer used. If it's still specified, a type error will occur, so simply remove it.
