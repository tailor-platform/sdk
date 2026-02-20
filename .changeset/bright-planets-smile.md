---
"@tailor-platform/sdk": patch
---

Refactor application initialization and fix generate command ordering

- Split `defineApplication` (sync, lightweight) and `loadApplication` (async, full initialization)
- Remove `MutableApplication` type cast and mutable closure state
- Move plugin file generation logic into `PluginManager.generatePluginFiles()`
- Extract `buildApplication`, `defineServices`, and `generatePluginFilesIfNeeded` helper functions
- Fix `generate` command to restore interleaved type loading/generation flow instead of using `loadApplication()` which bundled before generators ran
- Clean up: make `pluginExecutorFiles` private, remove unused re-export, fix stale comments
