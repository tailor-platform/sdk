---
"@tailor-platform/sdk": patch
---

`tailor init` now exits non-zero when project scaffolding fails, instead of exiting 0. It reports `INIT_FAILED` when `create @tailor-platform/sdk` exits with a non-zero code or is terminated by a signal, and `INIT_SPAWN_FAILED` when the package manager cannot be started.
