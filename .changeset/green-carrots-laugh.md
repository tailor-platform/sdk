---
"@tailor-platform/sdk-codemod": minor
"@tailor-platform/sdk": patch
---

Add the v3 codemods `v3/config-to-app` and `v3/config-to-workspace`, which `tailor upgrade` runs on the upgrade to v3. `v3/config-to-app` rewrites a `defineConfig()` config deployed on its own to `defineApp()`. `v3/config-to-workspace` merges the configs deployed to one workspace into one `defineWorkspace()` config in the upgraded directory and deletes them. Both record the config under `workspaces` in `.github/tailor.lock`, and report what they leave for a manual change. `tailor upgrade` now lists the files the codemods deleted.
