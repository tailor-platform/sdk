---
"@tailor-platform/sdk": patch
---

A `MIGRATION_FAILED` error from `tailor deploy` now names the migration whose script failed: its message starts with `Migration <namespace>/<number> failed`, and `error.context` carries `namespace` and `migrationNumber`. Under `--json` the error used to carry only the script's own message, so a deploy with several pending migrations did not say which one failed.
