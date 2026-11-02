---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: Remove `tailor tailordb migration set`. It moved a namespace's migration checkpoint without changing its tables, so the checkpoint could stop matching the tables and the next deploy stopped with `MIGRATION_REMOTE_DRIFT`. Use `tailor tailordb migration sync <N>` instead: when the tables already match migration `<N>`, only the checkpoint changes, and `--force` replaces another migration history ID as `set --force` did. To re-run a failed migration in a development workspace, run `tailor tailordb migration sync <previous>`, which also removes the fields the failed migration added and deletes the tables it added together with their data. Settle a migration that an earlier deploy left in progress with `tailor tailordb migration resolve --complete` or `--rollback`. Errors and documentation that suggested `set` now suggest `sync`.
