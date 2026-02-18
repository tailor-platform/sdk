---
"@tailor-platform/sdk": patch
---

Refactor application initialization to eliminate executorService reassignment

- Split `defineApplication` (sync, lightweight) and `loadApplication` (async, full initialization)
- Remove `MutableApplication` type cast and mutable closure state
- Move plugin file generation logic into `PluginManager.generatePluginFiles()`
- Extract `buildApplication` and `generatePluginFilesIfNeeded` helper functions
