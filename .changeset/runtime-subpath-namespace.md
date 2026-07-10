---
"@tailor-platform/sdk": major
"@tailor-platform/sdk-codemod": patch
"@tailor-platform/create-sdk": patch
---

Remove flat value and default exports from `@tailor-platform/sdk/runtime/*` subpath modules. Import each subpath through its self-named namespace export instead, for example `import { iconv } from "@tailor-platform/sdk/runtime/iconv"`.

The aggregate `@tailor-platform/sdk/runtime` entry remains named-only, and its deprecated `file.deleteFile` alias is removed in favor of `file.delete`. The v2 codemod rewrites straightforward namespace-star subpath imports, flat named value imports, and aggregate `file.deleteFile` calls to the new namespace-object style.

`TailorContextAPI` and `TailorWorkflowAPI` now describe the SDK wrapper objects. Code that types the platform-provided `globalThis.tailor.context` or `globalThis.tailor.workflow` objects directly must use `PlatformContextAPI` or `PlatformWorkflowAPI` instead.
