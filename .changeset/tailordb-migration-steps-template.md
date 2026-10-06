---
"@tailor-platform/sdk": minor
---

`tailor tailordb migration generate` and `tailor tailordb migration script` accept `--steps` to scaffold `migrate.ts` as a multi-step script that exports `steps` instead of `main`. The scaffold has one step per schema change that needs a data migration, holding the statements `main` would have contained and ordered with `dependsOn` where steps touch the same field, and `migration script --with-test` writes the test scaffolds against `steps` when `migrate.ts` exports it.
