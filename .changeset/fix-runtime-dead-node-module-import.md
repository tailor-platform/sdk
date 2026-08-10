---
"@tailor-platform/sdk": patch
---

Remove a dead `node:module` import from a shared runtime helper chunk that could cause resolver bundling (and `deploy`) to fail with an `UNRESOLVED_IMPORT` error for projects importing `@tailor-platform/sdk/runtime`
