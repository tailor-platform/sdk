---
"@tailor-platform/sdk": patch
---

Fix `tailor deploy` keeping a TailorDB table and its records when its pending migrations remove or rename away the table and a later one adds it back. For example, with the workspace at `0000`, `0001` adds an optional field `f2` to `Item` with a `migrate.ts` that writes it, `0002` removes `Item`, and `0004` adds it back: the `migrate.ts` of `0001` failed with `field 'f2' not found` because the field was never added, and without that script the deploy finished with `Item` still holding the records it had before `0002`.

The migration that removes or renames away such a table now deletes it with its records once its checkpoint is committed, and the migration that adds it back creates it again, the same as deploying each migration on its own; the migrations before the removal apply their schema changes to it. When the workspace has the table, the deploy plan lists it as deleted and created, so a deploy without `--yes` asks to confirm the deletion. With `--no-schema-check`, a table that a pending migration removes or renames away is deleted the same way even when the local definitions still have it; unless a later pending migration adds it back, its local definition creates it again.

A table whose definition a pending migration changes and a later one changes back now also gets the definition of each migration while the migrations run. Before, it kept the deployed definition, so a `migrate.ts` that wrote a field such a migration added failed.
