---
"@tailor-platform/sdk": minor
---

The `db.pglite.ts` that `tailor tailordb migration generate` writes now enforces relations: a row pointing at a parent that does not exist is rejected, as on the platform. Migration tests that stage a row whose parent is missing must create the parent first or stage the row with `prepareRecords`. A relation the pre-migration schema cannot satisfy is left unenforced: one whose pending type change leaves the field a different type from its target, or one the migration retargets.

`prepareRecords` from `@tailor-platform/sdk/vitest` writes a test's starting records with relations unchecked, so a migration test can stage rows that predate a relation, and checks them again before the script runs. The migration PGlite test scaffold uses it.
