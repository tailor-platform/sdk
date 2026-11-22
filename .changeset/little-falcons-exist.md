---
"@tailor-platform/sdk": patch
---

Errors and warnings that quote a failure's message no longer add a period after a message that already ends with sentence-ending punctuation (`.`, `!`, `?`, `。`, `！`, or `？`), for example `DEPLOYED_HOOK_FAILED` and the TailorDB migration warnings of `tailor deploy`, and the cleanup warnings of `tailor workspace prune` and `tailor tailordb migration resolve` and `test`.
