---
"@tailor-platform/sdk": patch
---

`tailor deploy` and every `tailor tailordb migration` subcommand except `script` now reject a migration directory that has `migrate.ts` or other generated files but no `diff.json`. Previously, such a leftover in the latest migration number let the next `migration generate` reuse that number and deploy run the stale script. They also reject a `diff.json` in `0000/`, which was previously ignored. `tailor tailordb migration status` now reports invalid migration files as an error for that namespace.
