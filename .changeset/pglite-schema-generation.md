---
"@tailor-platform/sdk": minor
---

Add `pgliteSchemaPath` to `kyselyTypePlugin` to generate the PGlite `CREATE TABLE` script for every TailorDB table alongside the Kysely types, so tests using `mockTailordbWithPGlite` or `createKyselyPGlite` no longer hand-write DDL
