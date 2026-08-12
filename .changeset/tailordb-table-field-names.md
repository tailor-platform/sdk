---
"@tailor-platform/sdk": patch
---

TailorDB migration diffs now name the table they describe with `tableName` instead of `typeName`, and a rename records `previousTableName` instead of `previousTypeName`, continuing the `db.type()` → `db.table()` rename. Migration histories written by earlier versions keep replaying: the legacy field names in committed `diff.json` files are still read and normalized on load, across change entries, breaking changes, and warnings, so no migration files need editing. Migration file format version is now 4 and this SDK reads versions 1 through 4.

Code that imports `MigrationDiff` / `DiffChange` / `BreakingChangeInfo` from `@tailor-platform/sdk/cli` and reads the renamed properties no longer compiles:

| Old spelling                 | New spelling                  |
| ---------------------------- | ----------------------------- |
| `change.typeName`            | `change.tableName`            |
| `change.previousTypeName`    | `change.previousTableName`    |
| `breakingChanges[].typeName` | `breakingChanges[].tableName` |
| `warnings[].typeName`        | `warnings[].tableName`        |

Update those reads to the new spelling. `tailor tailordb migration validate --json` renames the same key wherever it appears in its output, so anything parsing that JSON needs the same update.

The `typeName` field on executor record triggers, the `.typeName()` field builder, and the file-runtime `typeName` argument are unrelated and unchanged.
