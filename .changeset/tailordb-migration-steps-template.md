---
"@tailor-platform/sdk": minor
---

`tailor tailordb migration generate` and `tailor tailordb migration script` now scaffold `migrate.ts` as a multi-step script that exports `steps`. It has one step for each schema change that needs a data migration, and steps that touch the same field are ordered with `dependsOn`. `migration script --with-test` writes the test scaffolds against `steps` when `migrate.ts` exports it.

Where a generated `migrate.ts` leaves a value or logic for you to decide, such as what an added required field holds in existing records, it now calls `TODO(message)` from `./db` instead of writing `null` next to a `// TODO:` comment or a `never` annotation. The migration fails at that call, and `tailor tailordb migration validate` and `tailor deploy` reject a `migrate.ts` that still calls it before anything is changed. `tailor deploy` also rejects a `migrate.ts` that still carries the `TODO(tailor-migration-review)` marker earlier versions generated, which only `migration validate` checked before.
