---
"@tailor-platform/sdk": patch
---

The remaining CLI errors and generated artifacts that named a `db.table()` definition a type now say table.

- The seed chunker's oversized-record error reads `A single record in table "Order" ...`.
- The duplicate plugin-generated table name error reads `Duplicate plugin-generated table name "..."`, and the header of each generated `.tailor/<plugin-id>/types/*.ts` file reads `Auto-generated table by plugin`. Both name the originating table (or `(namespace)`) under a neutral `source:` / `Source:` key.
- The seed plugin's generated `_User.schema.ts` comment reads `no TailorDB backing table`. The next `tailor generate` rewrites the file; existing files keep working as-is.

The `(type)` label in the deploy plan and in `deploy --dry-run --json` `changes[].labels` is intentionally unchanged: it is documented machine-readable output, and renaming it would break CI that matches on the value.
