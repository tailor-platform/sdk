---
"@tailor-platform/sdk": patch
---

Fix the migration `db.ts` types to match the app's generated Kysely types: inserts can leave out fields that have a default or a create hook (such as `db.fields.timestamps()`), and values for serial fields are rejected. A serial field whose existing values the migration script has to fill or deduplicate stays writable. Existing `db.ts` files are not regenerated.
