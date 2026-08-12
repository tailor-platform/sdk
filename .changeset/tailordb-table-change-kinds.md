---
"@tailor-platform/sdk": minor
---

TailorDB migration diffs now describe table-level changes as `table_*` instead of `type_*`, matching `db.table()`. Migration histories written by earlier versions keep working: `type_*` change kinds in committed `diff.json` files are still read and normalized on load. Migration file format version is now 3, and CLI diff output reads `[Table]` and `table(s) added` where it previously read `[Type]` and `type(s) added`.
