---
"@tailor-platform/sdk": minor
---

Added `buildOptions.inlineSourcemapProjectSources` to choose which of your own source files embed their text in the inline sourcemap. `exclude: ["src/generated/**"]` leaves out the text of generated files, and `include` keeps only the matching files. Files under `node_modules` stay controlled by `inlineSourcemapDependencySources`. Bundled resolvers, executors, workflows, and auth hooks now record sourcemap `sources` relative to the project root.
