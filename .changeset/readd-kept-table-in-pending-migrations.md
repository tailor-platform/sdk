---
"@tailor-platform/sdk": patch
---

Fix `tailor deploy` keeping a TailorDB table and its records when its pending migrations remove the table and a later one adds it back. For example, with the workspace at `0000`, `0001` adds an optional field to `Item` with a `migrate.ts` that writes it, `0002` removes `Item`, and `0004` adds it back: the `migrate.ts` of `0001` failed with `field 'f2' not found` because the field was never added, and without that script the deploy finished with `Item` still holding the records it had before `0002`.

The migration that removes such a table now deletes it with its records once its checkpoint is committed, and the migration that adds it back creates it again, the same as deploying each migration on its own; the migrations before the removal apply their schema changes to it. The deploy plan lists the table as deleted and created, so a deploy without `--yes` asks to confirm the deletion. With `--no-schema-check`, a table that a pending migration removes is deleted the same way even when the local definitions still have it, and its local definition creates it again.
