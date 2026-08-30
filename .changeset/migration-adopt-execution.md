---
"@tailor-platform/sdk": patch
---

When a `tailor deploy` is interrupted while a migration script is still running, a deploy started while that script is still running now waits for its outcome instead of executing the script a second time.
