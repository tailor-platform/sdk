---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/create-sdk": patch
---

`tailor seed` now calls a `db.table()` definition a table instead of a type, in its help, progress, and errors — `Seeding 3 tables via Kysely batch insert`, `The following tables were not found: …`. The `fillSeedData` documentation and the `create-sdk` template hint follow.

The `types` positional keeps its name; only the wording around it changed, so existing invocations are unaffected.
