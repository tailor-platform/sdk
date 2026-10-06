---
"@tailor-platform/sdk": minor
---

`tailor tailordb migration generate` and `tailor tailordb migration script` now scaffold `migrate.ts` as a multi-step script that exports `steps`. It has one step for each schema change that needs a data migration, holding the statements a `main` script would have contained, and steps that touch the same field are ordered with `dependsOn`. `migration script --with-test` writes the test scaffolds against `steps` when `migrate.ts` exports it.
