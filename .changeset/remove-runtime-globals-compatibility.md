---
"@tailor-platform/sdk": major
"@tailor-platform/sdk-codemod": patch
---

Remove the v1 runtime globals compatibility layer. Importing from `@tailor-platform/sdk` no longer activates the ambient `tailor.*` / `tailordb.*` declarations; opt into globals with `@tailor-platform/sdk/runtime/globals` or use the typed wrappers from `@tailor-platform/sdk/runtime`.

The capital-cased `Tailordb.*` namespace is removed. If your project still references `Tailordb.QueryResult`, `Tailordb.CommandType`, `Tailordb.Client`, or `typeof Tailordb.Client`, migrate before upgrading: run `pnpm dlx @tailor-platform/sdk-codemod v2/tailordb-namespace` to rewrite them to lowercase `tailordb.*`, then add `import "@tailor-platform/sdk/runtime/globals"` so the rewritten references resolve.
