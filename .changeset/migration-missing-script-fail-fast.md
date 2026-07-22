---
"@tailor-platform/sdk": minor
---

Fail `deploy` when a migration with breaking changes is missing its `migrate.ts` instead of silently leaving the migration unapplied while reporting success. Migration validation (missing scripts and schema checks) now runs while planning, so these failures also surface under `--dry-run` and before any resource is applied. Add `tailordb migration script <n> --no-script --reason "..."` to explicitly record that a migration needs no script; acknowledged migrations deploy their schema changes as usual and skip only the script step.
