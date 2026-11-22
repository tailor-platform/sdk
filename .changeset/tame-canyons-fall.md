---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-setup": patch
---

Internal: for a workspace config defined with `defineWorkspace()` or `defineApp()`, which is not exported yet, `tailor show` and `tailor open` take `--app`, `tailor data clone` clones its only application, `tailor remove` stops and points to `tailor deploy` and `tailor workspace delete`, and `tailor setup ci` generates one deploy for the whole workspace and records the config under `workspaces` in `.github/tailor.lock`. Nothing changes for a `defineConfig()` config.
