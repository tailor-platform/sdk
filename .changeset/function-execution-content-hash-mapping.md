---
"@tailor-platform/sdk": patch
---

Stack traces shown by `tailor-sdk function logs <id>` now map back to original sources even after the deployed function has been updated. The `FunctionExecution.contentHash` reported by the server is used to download the exact bundle that ran, so source locations stay accurate across redeploys. Older servers that do not report `contentHash` keep using the existing `updatedAt` staleness fallback.
