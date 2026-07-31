---
"@tailor-platform/sdk": major
---

Release SDK v2. v2 introduces breaking changes to the SDK API and CLI (the CLI binary is now `tailor`). To migrate from 1.x, run the bundled codemods with `npx @tailor-platform/sdk-codemod --from <current-version> --to <target-version>` and follow the [migration guide](https://github.com/tailor-platform/sdk/blob/main/packages/sdk/docs/migration/v2.md). The 1.x line continues to receive patches on the `v1` dist-tag.
