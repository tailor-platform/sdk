---
"@tailor-platform/create-sdk": patch
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-codemod": patch
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-setup": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Depend on `@politty/zod` directly instead of the `politty` wrapper package. `politty` re-exported everything from `@politty/zod` unchanged, so this is an internal dependency swap with no effect on CLI behavior.
