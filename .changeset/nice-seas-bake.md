---
"@tailor-platform/sdk": patch
---

`.serial()` formats with an octal `%o` specifier or a literal `%%` now reproduce in the PGlite schema: `tailor generate` with `kyselyTypePlugin({ pgliteSchemaPath })` no longer fails on them, `tailor tailordb migration generate` writes `db.pglite.ts`, and `tailor tailordb migration script --with-test` also writes `migrate.pglite.test.ts`.
