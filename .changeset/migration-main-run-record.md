---
"@tailor-platform/sdk": patch
---

`tailor deploy` no longer runs a migration's `main` script again after it could not confirm whether an earlier run of it succeeded (`MIGRATION_OUTCOME_UNKNOWN`), including with `--no-schema-check`, in a namespace without a migration checkpoint, and after the deploy process stopped while the script ran. The migration now stays recorded as in progress while its script runs, and until you settle a run the deploy could not confirm, `tailor deploy` stops before changing anything with `MIGRATION_OUTCOME_UNSETTLED`, which reports how the run stands.

Settle such a run with `tailor tailordb migration resolve`: `--complete` when it succeeded, `--rollback` when it failed, was canceled, or did not start. `resolve` now reads how the run ended, shows it (`runStatus` under `--json`), and warns when the option you passed does not fit. The earlier advice to run `tailor tailordb migration sync` no longer applies to these runs: `sync` refuses to run while the migration is recorded. `tailor tailordb migration status` reports the run as in progress, with `inProgressMigrationRun: "main"` under `--json`. Earlier SDK versions cannot read this record and refuse to deploy until the migration is settled.
