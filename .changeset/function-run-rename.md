---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": minor
---

`tailor function test-run` is renamed to `tailor function run`. The old name keeps working as a deprecated alias until v3 and prints a deprecation warning when used; `tailor upgrade` offers the `v3/function-test-run-rename` codemod to rewrite `function test-run` invocations in package.json scripts, shell scripts, YAML, and Markdown.
