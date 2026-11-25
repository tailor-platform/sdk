---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-setup": patch
---

Internal: for a workspace config defined with `defineWorkspace()` or `defineApp()`, which is not exported yet, `tailor show` and `tailor open` take `--app`, `tailor show` without it, for a config with several applications, lists the deployed ones and warns about the others, `tailor data clone` clones its only application, `tailor remove` stops and points to `tailor deploy` and `tailor workspace delete`, and `tailor setup ci` generates one deploy for the whole workspace, records the config under `workspaces` in `.github/tailor.lock`, rejects `--erd-preview`, and takes `--migration-test` only when the config deploys one application that lists every TailorDB namespace with migrations. For a `defineConfig()` config, `--app` accepts only the config's own name, and nothing else changes.
