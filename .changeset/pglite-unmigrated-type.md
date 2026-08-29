---
"@tailor-platform/sdk": minor
---

Add `Unmigrated<Database>` to `@tailor-platform/sdk/vitest` for staging pre-migration rows in a PGlite test. Typing `createKyselyPGlite<Unmigrated<Database>>(...)` lets `insertInto` and `updateTable` write whatever a column can still be read as — `null` into a column the migration makes required, a removed value into an enum it narrows — so the rows the script has to convert can be staged through the typed API, while `main` still runs against the strict `Database` from `db.ts`.
