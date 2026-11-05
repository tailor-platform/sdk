---
"@tailor-platform/sdk": patch
---

`tailor deploy` no longer stops with `MIGRATION_REMOTE_DRIFT` when an earlier deploy left a migration's pre-migration schema changes or maintenance mode in place without recording the migration as in progress, for example because it stopped right after those changes or could not roll them back. It runs that migration again from the start. `tailor tailordb migration resolve --rollback` returns such a namespace to its checkpoint without deploying, and `tailor tailordb migration validate` reports it as valid.
