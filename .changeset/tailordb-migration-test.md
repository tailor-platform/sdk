---
"@tailor-platform/sdk": minor
---

Add `tailor tailordb migration test` to rehearse pending migrations in an isolated workspace. The command can load generated seed fixtures or clone source TailorDB records, run the real migration phases, optionally execute a Kysely assertion script, and automatically delete workspaces it creates.
