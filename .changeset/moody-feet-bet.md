---
"@tailor-platform/sdk": patch
---

Field and table definitions written with `db` and `t` in your own code no longer keep an otherwise unused call in bundled resolvers, executors, workflow jobs, auth hooks, and `tailor function run` scripts, which makes bundles that import shared schema modules smaller.
