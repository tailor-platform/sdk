---
"@tailor-platform/eslint-plugin-sdk": minor
---

Add a `check` option to `no-node-builtin-imports` and `no-node-only-globals`. With `{ "check": "all-files" }` in an override whose `files` cover the code bundled into your functions, the rules also report Node built-in imports and Node-only globals in helper modules that define no resolver, executor, workflow job, or HTTP adapter, so you see them while editing the helper instead of at `tailor generate` or `deploy`. Since a helper may be bundled into an HTTP adapter, its messages omit the suggested alternatives, which are written for `body` functions. The default, `"definition-files"`, keeps the current behavior.
