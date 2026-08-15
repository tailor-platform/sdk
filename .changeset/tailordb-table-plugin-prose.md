---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/create-sdk": patch
---

`tailor seed` now calls a `db.table()` definition a table instead of a type, in its help, progress, and errors — `Seeding 3 tables via Kysely batch insert`. The `fillSeedData` documentation and the `create-sdk` template hint follow.

Messages that list the seed targets say entities rather than tables, because `_User` is an IdP entity rather than a TailorDB table and can appear in the same list.

The `types` positional keeps its name; only the wording around it changed, so existing invocations are unaffected.
