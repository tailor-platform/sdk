---
"@tailor-platform/sdk": minor
---

Add `buildOptions.treeshake` to `defineConfig` to control how unused code is removed from bundled functions. Set `propertyReadSideEffects: false` to drop calls whose arguments only read properties, which keeps modules a function never reaches out of its bundle. `moduleSideEffects`, `annotations`, and `unknownGlobalSideEffects` override the SDK's defaults. Nothing changes unless you set it.
