---
"@tailor-platform/sdk": patch
---

`tailor deploy` no longer starts a migration's script when the namespace's checkpoint or migration history changed after the deploy read it, for example through `tailor tailordb migration set` or another deploy. It fails with `MIGRATION_CHECKPOINT_CONFLICT` before recording the migration as in progress, instead of recording it on top of the changed checkpoint, which left every later deploy and `tailor tailordb migration resolve` refusing the namespace. When it cannot read them at that point, it fails with `MIGRATION_CHECKPOINT_UNVERIFIED` without starting the script. A deploy whose first migration of a namespace fails before its checkpoint now also returns the tables to their previous settings when the namespace had no checkpoint yet or, with `--no-schema-check`, records another migration history; it used to report the checkpoint as changed concurrently and leave the tables in maintenance mode.
