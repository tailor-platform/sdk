---
"@tailor-platform/sdk": patch
---

Reject `.serial()` on fields inside `db.object()`: it is now a type error and fails at build, instead of deploying a field that cannot be numbered.
