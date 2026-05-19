---
"@tailor-platform/sdk-codemod": patch
---

Add two v2 codemods for the `@tailor-platform/function-types` → `@tailor-platform/sdk` vendoring:

- `v2/tailordb-namespace`: rewrite references to the deprecated capital-cased `Tailordb` ambient namespace (`Tailordb.QueryResult`, `Tailordb.CommandType`, `Tailordb.Client`, `typeof Tailordb.Client`) to the new lowercase `tailordb.*` namespace re-published by the SDK.
- `v2/drop-function-types-dep`: remove `@tailor-platform/function-types` from `package.json` (`dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies`) and from `tsconfig.json` `compilerOptions.types`, since its declarations are now vendored inside the SDK.
