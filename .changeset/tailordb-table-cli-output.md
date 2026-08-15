---
"@tailor-platform/sdk": patch
---

The remaining CLI output and generated artifacts that named a `db.table()` definition a type now say table.

- The deploy plan labels a TailorDB table change `(table)` instead of `(type)`. This also changes the machine-readable `deploy --dry-run --json` output: the `changes[].labels` value `"type"` becomes `"table"`. Update any CI that matches on the old label.
- The seed chunker's oversized-record error reads `A single record in table "Order" ...`.
- The duplicate plugin-generated table name error reads `Duplicate plugin-generated table name "..."` with `source table:` details, and the header of each generated `.tailor/<plugin-id>/types/*.ts` file reads `Auto-generated table by plugin` / `Source table:`.
- `toSchemaOutput` from `@tailor-platform/sdk/test` reports `Failed to parse table ...`.
- The seed plugin's generated `_User.schema.ts` comment reads `no TailorDB backing table`. Regenerate with `tailor generate` to pick it up; existing files keep working as-is.
