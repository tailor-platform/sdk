---
"@tailor-platform/sdk": minor
---

Write `db.pglite.ts` next to every generated migration `db.ts` with the `CREATE TABLE` script of the schema `migrate.ts` runs against, and let `tailordb migration script --with-test` also scaffold `migrate.pglite.test.ts` when `@electric-sql/pglite` is installed
