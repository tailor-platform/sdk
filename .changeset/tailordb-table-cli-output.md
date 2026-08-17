---
"@tailor-platform/sdk": patch
---

The remaining CLI output and generated artifacts that named a `db.table()` definition a type now say table.

- The deploy plan labels a TailorDB table change `(table)` instead of `(type)`. This also changes the machine-readable `deploy --dry-run --json` output: the `changes[].labels` value `"type"` becomes `"table"`. Update any CI that matches on the old label.
- The seed chunker's oversized-record error reads `A single record in table "Order" ...`.
- The duplicate plugin-generated table name error reads `Duplicate plugin-generated table name "..."`, and the header of each generated `.tailor/<plugin-id>/types/*.ts` file reads `Auto-generated table by plugin`. Both name the originating table (or `(namespace)`) under a neutral `source:` / `Source:` key.
- The seed plugin's generated `_User.schema.ts` comment reads `no TailorDB backing table`. The next `tailor generate` rewrites the file; existing files keep working as-is.
