---
"@tailor-platform/sdk": patch
---

Fix webhook executors whose `headers` has an `undefined` value, which failed to load; that header is now left out of the request
