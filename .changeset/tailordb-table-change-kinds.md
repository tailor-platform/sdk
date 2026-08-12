---
"@tailor-platform/sdk": patch
---

TailorDB migration diffs now describe table-level changes as `table_*` instead of `type_*`, completing the `db.type()` → `db.table()` rename. Migration histories written by earlier versions keep working: `type_*` change kinds in committed `diff.json` files are still read and normalized on load, so no migration files need editing. Migration file format version is now 3 and this SDK reads versions 1 through 3. CLI diff output reads `[Table]` and `table(s) added` where it previously read `[Type]` and `type(s) added`.

Code that imports `MigrationDiff` / `DiffChange` from `@tailor-platform/sdk/cli` and compares `change.kind` against a renamed spelling no longer compiles, because the discriminant literal is gone from the union:

| Old spelling             | New spelling              |
| ------------------------ | ------------------------- |
| `type_added`             | `table_added`             |
| `type_removed`           | `table_removed`           |
| `type_renamed`           | `table_renamed`           |
| `type_modified`          | `table_modified`          |
| `type_settings_modified` | `table_settings_modified` |
| `type_scripts_modified`  | `table_scripts_modified`  |

Update those comparisons to the new spelling. Reading `diff.json` files is unaffected.
