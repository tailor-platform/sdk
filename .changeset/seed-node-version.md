---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-codemod": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Raise the minimum supported Node.js version to 22.18.0 (from 22.15.0).

`tailor seed validate` crashed on Node 22.15.0–22.17.x with `Expected a string, an ArrayBuffer, or a TypedArray to be returned for the "source" from the "load" hook but got null`. This is a Node.js bug ([nodejs/node#58607](https://github.com/nodejs/node/issues/58607)): requiring a `node:`-scheme-only builtin (`node:sqlite`, used internally by the seed validator) while both a synchronous `resolve` and `load` hook are registered via `module.registerHooks()` crashes the loader on those versions. The SDK always registers both hooks, so any project on Node 22.15.0–22.17.x hit this. Node fixed it upstream in 22.18.0 ([nodejs/node#58612](https://github.com/nodejs/node/pull/58612)); this release raises `engines.node` to match, since Node 22.15.0–22.17.x never actually supported `tailor seed validate`.
