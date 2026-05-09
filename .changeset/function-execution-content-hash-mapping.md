---
"@tailor-platform/sdk": patch
---

Pin function execution log sourcemap mapping to `FunctionExecution.contentHash` so stack traces map against the exact bundle that ran, even after redeploys. Older servers that do not populate `contentHash` continue to use the existing `updatedAt` staleness fallback.
