---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": minor
---

`tailor function run --name` is deprecated and will be removed in v3. It keeps working and prints a deprecation warning when used. Use `tailor workflow run <file> --job <name>` instead, which also runs the jobs the job starts with `.start()` and accepts only a JSON object or `null` as its argument. `tailor upgrade` reports each use of `function run --name` for a manual change through the `v3/function-run-name-to-workflow-run` codemod.
