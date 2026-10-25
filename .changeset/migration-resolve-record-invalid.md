---
"@tailor-platform/sdk": patch
---

`tailor tailordb migration resolve` now refuses to run when the in-progress migration is not the one right after the checkpoint. Previously, `--rollback` moved the checkpoint forward in that state, and `--complete` moved it past migrations whose `migrate.ts` never ran.
