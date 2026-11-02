---
"@tailor-platform/sdk": patch
---

`tailor deploy` now suggests `--force` when a migration's checkpoint changes during the deploy to a migration history other than the local one, or to one whose label cannot be read. `MIGRATION_CHECKPOINT_CONFLICT` used to suggest `tailor tailordb migration sync <N>` without `--force`, which `sync` refuses for such a namespace. It now suggests `sync <N> --force` only for when the local migration history should replace the deployed one, and otherwise suggests working from a checkout of the deployed history. The error names a different migration history only when the namespace records one other than the local history, and its `context` adds `localHistoryId`, `remoteHistoryIdInvalid`, and `historyIdMismatch`. The recovery hints that `tailor deploy`, `tailor tailordb migration status`, and `migration validate` print for a checkpoint outside the local history also suggest a checkout of the deployed history before their `--force` commands.
