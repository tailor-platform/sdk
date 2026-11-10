---
"@tailor-platform/sdk": patch
---

Type the optional fields and tables a migration adds in its generated `db.ts`, so `migrate.ts` can query them. A field the migration makes optional is now typed as nullable there, as in `db.pglite.ts`.
