---
"@tailor-platform/sdk": minor
---

Make `tailor seed validate` reject a seed row that carries a field the table does not declare, at the top level or inside a nested object, instead of passing it through to fail later as a database error in `tailor seed apply`. The issue names the field and how to fix the row.

Fields a plugin adds to a table are validated like the table's own. The seed schema generated for a table with plugins attached loads the table through the new `getExtendedTable()` helper from `@tailor-platform/sdk/plugin`, which returns the table with every plugin-added field applied, as `tailor generate` sees it. Run `tailor generate` after upgrading so the seed schema files are regenerated.
