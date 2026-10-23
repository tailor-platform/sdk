---
"@tailor-platform/sdk": patch
---

TailorDB migration commands now reject a migration directory that has `migrate.ts` or other generated files but no `diff.json`, and a `diff.json` in `0000/`, instead of reusing that number or running the leftover script. `tailor tailordb migration status` now also reports invalid migration files as an error for that namespace.
