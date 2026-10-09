---
"@tailor-platform/sdk": minor
---

Add `tailor tailordb migration resolve` to settle a migration that a failed deploy left in progress. `--rollback` returns the namespace to the schema before the failed migration and leaves the checkpoint where it was, so the next deploy runs that migration again from its first step. `--complete` applies the schema of the failed migration, moves the checkpoint to it without running its `migrate.ts` again, and is meant for use after you repaired the data by hand. Both options clear the in-progress record, re-enable GraphQL operations and record events for the namespace's tables, and remove the temporary resources of the failed run, so `deploy` and the other migration commands work again.
