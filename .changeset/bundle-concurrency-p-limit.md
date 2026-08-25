---
"@tailor-platform/sdk": patch
---

Internal refactoring: the bundle concurrency limiter now uses the `p-limit` dependency already used elsewhere in the CLI instead of a hand-rolled worker pool. The concurrency cap, input-order results, and failure handling are unchanged; the only observable difference is that the first bundle now starts a microtask later instead of synchronously.
