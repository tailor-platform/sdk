---
"@tailor-platform/sdk": patch
---

TailorDB migration messages now call a `db.table()` definition a table instead of a type, matching the vocabulary the docs already use. Schema drift details read `Table 'User' exists in snapshot but not in remote`, and a removal warning reads `Table removed (all records in this table will be deleted during post-migration cleanup)`.

The warning text is recorded in `diff.json`, so migrations generated before this release keep the wording they were written with. Nothing reads that text back, so both spellings stay valid.

Messages about a field's data type are unchanged, as is the `DB types:` line naming the generated `db.ts`.
