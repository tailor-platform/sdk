---
"@tailor-platform/sdk": minor
---

Add `tailor function script`, which scaffolds a one-off script executed by `tailor function run` without deploying. When `kyselyTypePlugin` is configured the skeleton imports the project's generated `getDB()`; otherwise the command generates a script-scoped `db.ts` and `db.snapshot.json` from the deployed schema, and `function run` refuses to execute the script when that snapshot no longer matches the deployed or locally defined table and field structure (override with `--allow-schema-drift`).
