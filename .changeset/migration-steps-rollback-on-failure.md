---
"@tailor-platform/sdk": minor
---

Let a TailorDB migration script that exports `steps` roll back instead of staying in progress when a step fails. Export `onFailure = "rollback"` next to `steps` and `tailor deploy` restores the pre-migration schema, clears the in-progress record, and takes the tables out of maintenance mode. The next deploy runs every step again from the beginning. If some tables cannot be rolled back, the deploy fails with `MIGRATION_ROLLBACK_INCOMPLETE`, names those tables in `context.failedTables`, and keeps them in maintenance mode until `tailor tailordb migration sync` returns them to the checkpoint. Without `onFailure`, or with `"resume"`, a failed run stays in progress as before
