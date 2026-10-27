---
"@tailor-platform/sdk": patch
---

`.unique()` and `.index()` on a `db.object()` field itself now fail type checking, and `tailor generate` and `tailor deploy` stop with an error naming the field. Before, such a table field failed to deploy with an internal platform error, and such a member of another `db.object()` was deployed without the setting, so in a namespace with `migration.directory` every later deploy stopped with `MIGRATION_REMOTE_DRIFT`. Remove the modifier; for such a member in a namespace with `migration.directory`, then run `tailor tailordb migration generate` and `tailor deploy --no-schema-check` once.
