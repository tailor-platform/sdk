---
"@tailor-platform/sdk": minor
---

Leave the source text of installed packages (everything under `node_modules`) out of the inline sourcemap in bundled resolvers, executors, workflow jobs, and auth hooks. The sourcemap makes up most of a bundled function's size, so this makes the bundles much smaller: in one project's resolver bundles the median dropped from 5.7 MB to 3.1 MB. Error positions in stack traces still resolve to the original files and lines, and your own source text is still embedded. `tailor function run` shows the code snippet for a frame inside an installed package from the package's file in your local `node_modules`. Set `buildOptions.inlineSourcemapDependencySources: true` to embed the source text of installed packages as before.
