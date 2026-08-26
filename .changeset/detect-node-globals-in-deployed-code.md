---
"@tailor-platform/sdk": patch
---

Fail `deploy` with a clear error when a resolver, executor, or workflow job references a Node-only global (`process`, `Buffer`, `require`, etc.) that the Tailor Platform runtime never defines, instead of deploying successfully and only failing with a `ReferenceError` at runtime. Use `defineConfig({ env })` and the `env` argument passed into the body function to read configuration values.
