---
"@tailor-platform/sdk-codemod": patch
---

Add `v2/tailordb-namespace` codemod for the `@tailor-platform/function-types` → `@tailor-platform/sdk` vendoring: rewrite references to the deprecated capital-cased `Tailordb` ambient namespace (`Tailordb.QueryResult`, `Tailordb.CommandType`, `Tailordb.Client`, `typeof Tailordb.Client`) to the new lowercase `tailordb.*` namespace re-published by the SDK.
