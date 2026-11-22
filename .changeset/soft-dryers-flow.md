---
"@tailor-platform/sdk": patch
---

Internal: `query`, `tailordb truncate`, the `tailordb migration` commands, `function run` and `script`, `workflow run` and `start`, `api`, and the `machineuser` and `oauth2client` commands run on a workspace config defined with `defineWorkspace()` or `defineApp()`, which is not exported yet; `query --app` chooses the application a GraphQL query runs against when such a config deploys several. Nothing else changes for a `defineConfig()` config.
