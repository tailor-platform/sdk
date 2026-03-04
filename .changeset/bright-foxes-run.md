---
"@tailor-platform/sdk": minor
---

Add `function test-run` CLI command to run functions on the Tailor Platform server without deploying. Supports auto-detection of resolver, executor, workflow job, and plain function types (including `export function main`). Bundles the function using rolldown and executes via TestExecScript API. Also supports passing pre-bundled `.js` files directly (e.g., from `.tailor-sdk/`) to skip detection and bundling. Automatically injects `env` from config and `user` context (with unauthenticated user fallback) into resolver, executor, and workflow-job entries.
