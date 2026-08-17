---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": minor
---

The `--branch` option of `tailor setup branch` is renamed to `--trigger-branch`, so it no longer collides with the subcommand name. The old spelling keeps working as a deprecated alias until v3 and prints a deprecation warning when used; `tailor upgrade` offers the `v3/setup-branch-flag-rename` codemod to rewrite `setup branch --branch` invocations across package.json scripts, shell and Windows scripts, YAML, Markdown, and JavaScript/TypeScript sources. The `--branch` option of `setup tag`, `setup preview`, and `setup coordinate` is unchanged.
