---
"@tailor-platform/sdk": patch
---

`.unique()` on a field inside `db.object()` is now applied to the deployed schema. Before, the constraint was recorded in the migration snapshot but sent to the platform as non-unique, so duplicate values were stored. After the deploy, the platform rejects a row whose inner value duplicates another row's.
