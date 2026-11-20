---
"@tailor-platform/sdk": minor
---

`tailor tailordb migration resolve --maintenance` takes the tables of a namespace out of the maintenance mode a deploy left in place after committing a migration, without settling a migration or moving the checkpoint. `tailor tailordb migration status` reports such a record and the command that releases it. `tailor tailordb migration rebaseline` now refuses to run while such a record remains and points to the new option. Before, it moved the checkpoint to `0000` and left the record at the old checkpoint, so the next `tailor deploy` stopped with `MIGRATION_REMOTE_DRIFT` (`settings changed`) until you ran `migration sync 0000`.
