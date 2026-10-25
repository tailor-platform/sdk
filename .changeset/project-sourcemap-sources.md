---
"@tailor-platform/sdk": minor
---

Added `buildOptions.inlineSourcemapProjectSources` to choose which of your own source files embed their text in the inline sourcemap. `exclude: ["src/generated/**"]` leaves out the text of generated files, and `include` keeps only the matching files. The globs are relative to the directory containing your config file. Files under `node_modules` stay controlled by `inlineSourcemapDependencySources`.
