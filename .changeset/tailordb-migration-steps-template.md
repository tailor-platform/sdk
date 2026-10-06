---
"@tailor-platform/sdk": minor
---

`tailor tailordb migration generate` and `tailor tailordb migration script` accept `--steps` to scaffold `migrate.ts` as a multi-step script that exports `steps` instead of `main`. The scaffold has one step per added required field and one step for every other change, holding the statements `main` would have contained, and `migration script --with-test` writes the test scaffolds against `steps` when `migrate.ts` exports it.
