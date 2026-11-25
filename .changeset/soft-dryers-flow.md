---
"@tailor-platform/sdk": patch
---

Internal: `query`, `tailordb truncate`, the `tailordb migration` commands, `function run` and `script`, `workflow run` and `start`, `api`, `seed`, and the `machineuser` and `oauth2client` commands run on a workspace config defined with `defineWorkspace()` or `defineApp()`, which is not exported yet. For the several Auth services such a config can have, a machine user or OAuth2 client can be written as `<auth>/<name>`, `startWorkflow()` and seedPlugin's `machineUserName` take `{ namespace, machineUserName }`, and `loadSeedContext()` returns `resolveMachineUser()` and `appName`. With such a config, `tailordb migration test --data clone` copies the data of its only application, which must list every namespace with pending migrations and exist in the source workspace; the command checks both before it sets up the target workspace.
