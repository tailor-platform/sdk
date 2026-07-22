---
"@tailor-platform/sdk": minor
---

Fail `deploy` when a migration with breaking changes is missing its `migrate.ts` instead of silently leaving the migration unapplied while reporting success. Add `tailordb migration script <n> --no-script --reason "..."` to explicitly record that a migration needs no script; acknowledged migrations deploy their schema changes as usual and skip only the script step.
