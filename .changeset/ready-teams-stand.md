---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: `tailor deploy --no-schema-check` now stops with `MIGRATION_CHECKPOINT_UNKNOWN` when a namespace's remote migration checkpoint is not in the local migration history, as `tailor deploy` without the option already did. Previously it moved the checkpoint back to the latest local migration and overwrote the tables with the local schema, for example when run from an outdated checkout. The option now skips only the local and remote schema checks. Pull the latest migration files, or move the checkpoint on purpose with `tailor tailordb migration sync <N>` or `tailor tailordb migration set <N>`, then deploy again. With or without the option, the error now suggests both commands for each namespace and reports each namespace's remote checkpoint and latest local migration in `context` under `--json`.
