---
"@tailor-platform/sdk": patch
---

A `tailor deploy` interrupted while a migration script was still running now waits for that script's outcome on the next run instead of executing the script a second time.
