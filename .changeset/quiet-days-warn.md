---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: `tailor tailordb migration set` now refuses the number of a migration that an earlier deploy left in progress, as it already refused every other number. Previously it moved the checkpoint to that migration and cleared its in-progress record without applying the migration's schema, taking its tables out of maintenance mode, or removing the temporary resources of the failed run, so the next deploy stopped with `MIGRATION_REMOTE_DRIFT`. Settle such a migration with `tailor tailordb migration resolve --complete`, which does all of these, or return to the migration before it with `tailor tailordb migration resolve --rollback`; a migration whose steps partly committed can also be resumed with `tailor deploy`.

`tailor tailordb migration status` now lists those commands under a migration in progress, keeping the `--config`, `--workspace-id`, and `--profile` it ran with, and `--json` reports them as `inProgressMigrationActions`, each with the `command` and `args` to run. The `MIGRATION_IN_PROGRESS` error of `set`, `sync`, `rebaseline`, and `migration test` suggests the same commands.
