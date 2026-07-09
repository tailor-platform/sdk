---
"@tailor-platform/sdk": major
"@tailor-platform/sdk-codemod": patch
---

Remove flat value exports from `@tailor-platform/sdk/runtime/*` subpath modules. Import each subpath through its default export or self-named namespace export instead, for example `import iconv from "@tailor-platform/sdk/runtime/iconv"` or `import { iconv } from "@tailor-platform/sdk/runtime/iconv"`.

The aggregate `@tailor-platform/sdk/runtime` namespace imports are unchanged. The v2 codemod rewrites straightforward namespace-star subpath imports and flat named value imports to the new namespace-object style.
