---
"@tailor-platform/sdk": minor
---

Add `function test-run` CLI command to run functions on the Tailor Platform server without deploying. Auto-detects resolver, executor, workflow job, and plain function types (including `export function main`). Bundles the function using rolldown and executes via TestExecScript API. Also supports passing pre-bundled `.js` files directly to skip detection and bundling. Automatically injects `env` from config into all function type entries. Embeds machine user context (id, attributes, workspaceId) into resolver entries as `user` and into executor entries as `actor`, resolved from the API and config. Auth namespace is resolved automatically from `config.auth.name`. Fixes error/logs separation in script executor to prevent log output from being duplicated in error messages.
