---
"@tailor-platform/sdk": minor
---

Let a TailorDB migration script that exports `steps` roll back instead of staying in progress when a step fails. Export `onFailure = "rollback"` next to `steps` and `tailor deploy` restores the pre-migration schema, clears the in-progress record, and takes the tables out of maintenance mode. The next deploy runs every step again from the beginning. If some tables cannot be rolled back, the deploy still fails with the step's original error and warns which tables need manual repair. Without `onFailure`, or with `"resume"`, a failed run stays in progress as before
