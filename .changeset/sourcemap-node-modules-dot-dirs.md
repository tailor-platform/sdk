---
"@tailor-platform/sdk": patch
---

Fix inline sourcemaps embedding the source text of files under `node_modules` that belong to no package, such as a generated client in `node_modules/.prisma`, when `buildOptions.inlineSourcemapDependencySources` is `false` or a package list. Such files are now embedded only when the option is `true`, and `tailor function run` and `tailor function logs` read their code snippets from your local files.
