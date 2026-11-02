---
"@tailor-platform/sdk": patch
---

`tailor deploy` now resumes a multi-step migration whose earlier deploy stopped during or after the post-migration schema changes but before recording the checkpoint, for example because the process was killed or the checkpoint write failed. It used to stop with `MIGRATION_REMOTE_DRIFT` on the tables that already had the post-migration schema, until `tailor tailordb migration resolve --complete` settled the migration or a deploy ran with `--no-schema-check`. Each table may now have either the pre-migration or the post-migration schema of that migration, and `tailor tailordb migration validate` accepts the same. The warning for a checkpoint write that could not be confirmed now says to deploy again for such a migration instead of to repair the checkpoint.
