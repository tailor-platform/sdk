---
"@tailor-platform/sdk": patch
---

`tailor function logs <execution-id>` no longer starts the error with a stray `: ` when the error has no name, such as an execution aborted by a timeout or cancellation; it shows the message alone.
