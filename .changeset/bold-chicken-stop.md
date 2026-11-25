---
"@tailor-platform/sdk": minor
---

`@tailor-platform/sdk/cli` exports the beta `generateWorkspaceUserTypes()`, which writes `tailor.d.ts` for a config that `loadConfigFile()` loads as a workspace.

Internal: installing `@tailor-platform/sdk` writes `tailor.d.ts` for a config defined with `defineWorkspace()` or `defineApp()`, which is not exported yet.
