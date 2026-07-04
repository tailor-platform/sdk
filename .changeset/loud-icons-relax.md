---
"@tailor-platform/sdk": patch
---

Reject duplicate executor names, and duplicate resolver names within the same namespace, with a clear error at load time instead of silently deploying only one of them.
