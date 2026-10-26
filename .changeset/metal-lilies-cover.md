---
"@tailor-platform/sdk": patch
---

Remove `@__PURE__` and `@__NO_SIDE_EFFECTS__` comments from bundled resolvers, executors, workflow jobs, auth hooks, HTTP adapters, and `tailor function run` scripts, and minify the scripts `tailor query` runs, to make them smaller.
