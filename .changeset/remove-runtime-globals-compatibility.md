---
"@tailor-platform/sdk": major
"@tailor-platform/sdk-codemod": patch
---

Remove the v1 runtime globals compatibility layer. Importing from `@tailor-platform/sdk` no longer activates the ambient `tailor.*` / `tailordb.*` declarations; opt into globals with `@tailor-platform/sdk/runtime/globals` or use the typed wrappers from `@tailor-platform/sdk/runtime`.

The capital-cased `Tailordb.*` namespace is removed. Run `pnpm dlx @tailor-platform/sdk-codemod v2/tailordb-namespace` before upgrading if your project still references `Tailordb.QueryResult`, `Tailordb.CommandType`, `Tailordb.Client`, or `typeof Tailordb.Client`.
