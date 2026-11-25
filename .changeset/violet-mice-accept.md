---
"@tailor-platform/sdk": patch
---

A migration's `db.pglite.ts` now leaves nullable a required integer serial field that the migration adds to an existing table, as `db.ts` already allows, so a migration test can stage existing rows with that column null. The `pgliteSchemaPath` output of `kyselyTypePlugin` likewise leaves nullable an integer serial field made optional with `.clone({ optional: true })` or `pickFields(..., { optional: true })`. A `db.pglite.ts` written before upgrading is not rewritten and keeps the column NOT NULL.
