---
"@tailor-platform/sdk": patch
---

TailorDB migration output now calls a `db.table()` definition a table instead of a type, matching the vocabulary the docs already use. Schema drift details read `Table 'User' exists in snapshot but not in remote`, a removal warning reads `Table removed (all records in this table will be deleted during post-migration cleanup)`, and the `--rename` / `--drop` / `--expand-contract` help and errors describe their arguments as `"Table.field"` and `"OldTable:NewTable"`.

Only the wording changed: those flags accept exactly the values they did before, and the removal warning recorded in `diff.json` is never read back, so migrations generated earlier keep their wording and stay valid.

Messages about a field's data type are unchanged, as is the `DB types:` line naming the generated `db.ts`.
