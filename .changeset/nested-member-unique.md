---
"@tailor-platform/sdk": patch
---

`.unique()` and `.index()` on a field inside `db.object()` are now applied to the deployed schema. Before, they were recorded in the migration snapshot but sent to the platform as off, so duplicate values were stored, and the next `tailor deploy` of a project with such a field stopped with `MIGRATION_REMOTE_DRIFT`, and `tailor tailordb migration validate` failed the same way. After upgrading, run `tailor deploy --no-schema-check` once to apply the setting; later deploys need no flag. Inside an array of objects the platform accepts `.unique()` but does not reject duplicate values. If stored rows already hold duplicate values for a field that gains `.unique()`, that deploy fails with a unique index error and the schema stays unchanged until the duplicates are resolved.
