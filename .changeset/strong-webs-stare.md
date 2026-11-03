---
"@tailor-platform/sdk": patch
---

Fix `.start()` calls in a workflow, resolver, or executor file that declares its own `tailor` (for example, a workflow job exported as `tailor`), which failed at runtime after deploy.
