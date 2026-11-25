---
"@tailor-platform/sdk": patch
---

Fix `tailor deploy` failing with `table '<name>' not found` when one deploy applies a TailorDB migration that adds a table and a later migration that removes it again or renames it away. For example, `0001` adds table `Archive` and its `migrate.ts` writes to it, and `0002` removes `Archive`: the deploy never created `Archive`, because the final schema does not have it, so the script of `0001` failed. The same happened to a table that a migration adds back after an earlier migration of the same deploy removed it, when a later migration removes it again.

The deploy now creates such a table before the script of the migration that adds it, and deletes it once the checkpoint of the migration that removes or renames it away is committed.

The deploy also creates the GraphQL permission such a table has in its migration, as it now does for a table of the checkpoint that a later migration removes. Previously, when a deploy stopped partway through a migration while such a table existed, the next deploy stopped with `MIGRATION_REMOTE_DRIFT` ("GQL permission changed") instead of resuming the migration.
