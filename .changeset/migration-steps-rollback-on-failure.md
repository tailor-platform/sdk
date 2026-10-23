---
"@tailor-platform/sdk": minor
---

Let a TailorDB migration script that exports `steps` roll back instead of staying in progress when a step fails. Export `onFailure = "rollback"` next to `steps` and `tailor deploy` restores the pre-migration schema, clears the in-progress record, and takes the tables out of maintenance mode. The deploy then fails with the step's error under the code `MIGRATION_ROLLED_BACK`, and the next deploy runs every step again from the beginning. Nothing is rolled back while the run may still be executing, or when the in-progress record cannot be cleared. If some tables cannot be rolled back, the deploy warns which tables need manual repair. Without `onFailure`, or with `"resume"`, a failed run stays in progress as before
