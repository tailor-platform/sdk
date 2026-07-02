---
"@tailor-platform/sdk": patch
---

Fail with a clear error instead of producing corrupted bundle code when nested `.trigger()` calls (e.g. `jobA.trigger(jobB.trigger(...))`) are found during build-time rewriting
