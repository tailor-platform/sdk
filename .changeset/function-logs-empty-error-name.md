---
"@tailor-platform/sdk": patch
---

`tailor function logs <execution-id>` no longer shows a stray `: ` in the error when its name or message is empty. An execution aborted by a timeout or cancellation, which has no error name, now shows just its message.
