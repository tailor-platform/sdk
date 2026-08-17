---
"@tailor-platform/sdk": minor
---

Add `tailor function script`, which scaffolds a one-off script executed by `tailor function run` without deploying. By default, the skeleton imports the project's generated `getDB()` when `kyselyTypePlugin` is configured; without the plugin, the command generates a script-scoped `db.ts` and `db.snapshot.json` from local table definitions. Pass `--remote` to generate those script-scoped files from a deployed or external namespace instead. `function run` refuses to execute the script when that snapshot no longer matches the deployed or locally defined table and field structure (override with `--allow-schema-drift`).
