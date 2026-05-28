---
"@tailor-platform/sdk": patch
---

Cap parallel bundling of resolvers, executors, and workflow jobs to avoid OOM/SIGTERM on CI runners with many resolvers. Concurrency defaults to `os.cpus().length` and can be overridden via the `TAILOR_BUNDLE_CONCURRENCY` env var.
