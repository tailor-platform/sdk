---
"@tailor-platform/sdk": minor
---

Add `Unmigrated<Database>` to `@tailor-platform/sdk/vitest` for staging pre-migration rows in a PGlite test. Typing `createKyselyPGlite<Unmigrated<Database>>(...)` lets `insertInto` and `updateTable` write `null` into the columns the migration makes required — the rows the script has to backfill — while `main` still runs against the strict `Database` from `db.ts`.
