---
"@tailor-platform/sdk-codemod": patch
---

Remove the `v3/setup-branch-flag-rename` codemod. It rewrote `tailor setup branch --branch` to `--target`, but `@tailor-platform/sdk-plugin-setup` now removes the `--branch` alias outright instead of deprecating it until v3, so the rewrite no longer applies.
