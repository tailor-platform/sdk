---
"@tailor-platform/sdk": major
"@tailor-platform/sdk-codemod": patch
---

Rename the CLI binary from `tailor-sdk` to `tailor`.

The output directory default changes from `.tailor-sdk` to `.tailor`, and the GitHub Actions lock file path changes from `.github/tailor-sdk.lock` to `.github/tailor.lock`.

Run the `v2/rename-bin` codemod to migrate `tailor-sdk` invocations in package.json scripts, shell scripts, CI workflows, and documentation:

```sh
npx @tailor-platform/sdk-codemod --from 1.x --to 2.0.0
```
