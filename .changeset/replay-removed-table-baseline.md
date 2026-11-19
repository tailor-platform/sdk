---
"@tailor-platform/sdk": patch
---

Fix `tailor deploy` failing with `internal error` when it replays a TailorDB migration history from `0000` into a workspace without a checkpoint and a later migration removes a table. For example, `0000` creates tables `A` and `B` (`B.aId` references `A`), `0001` has a `migrate.ts` that runs an UPDATE, and `0002` removes `A`: the deploy never created `A`, so `B` kept a foreign key to a table that did not exist and the UPDATE in `0001` failed. A rename failed the same way, because the generated script of the renaming migration reads the old table.

The deploy now creates every table of the `0000` schema before the first `migrate.ts` runs, including the ones a later migration removes or renames away, and the migration that removes or renames a table deletes it once its checkpoint is committed. A table that a later migration removes and then adds again is deleted at the removal and created again at the addition.
