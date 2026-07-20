---
"@tailor-platform/sdk": major
"@tailor-platform/sdk-codemod": patch
---

`seedPlugin` no longer generates the `exec.mjs` seed runner. Seeding and validation move to the `tailor seed` commands provided by the `@tailor-platform/sdk-plugin-seed` CLI plugin: install it with `npm install -D @tailor-platform/sdk-plugin-seed`, replace `node <distPath>/exec.mjs` with `tailor seed apply` and `node <distPath>/exec.mjs validate` with `tailor seed validate`, and delete the stale generated `exec.mjs`. Seed data and schema generation (`data/*.jsonl`, `data/*.schema.ts`) is unchanged. Because the plugin reads the config at run time, `machineUserName` changes in seedPlugin options now take effect without regenerating. `@tailor-platform/sdk/cli` gains `loadSeedContext` (and `SeedContext` types) for this, `SeedData` is now JSON-typed, and `executeScript` accepts a plain object `invoker` (`ScriptInvoker`).
