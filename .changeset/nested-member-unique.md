---
"@tailor-platform/sdk": patch
---

`.unique()` on a field inside `db.object()` is now applied to the deployed schema. Before, the constraint was recorded in the migration snapshot but sent to the platform as non-unique, so duplicate values were stored, and the next `tailor deploy` of a project with such a field stopped with `MIGRATION_REMOTE_DRIFT`, and `tailor tailordb migration validate` failed the same way. After upgrading, run `tailor deploy --no-schema-check` once to apply the constraint; later deploys need no flag. Inside an array of objects the platform accepts the declaration but does not reject duplicate values. If stored rows already hold duplicate values for the field, that deploy fails with a unique index error and the schema stays unchanged until the duplicates are resolved.
