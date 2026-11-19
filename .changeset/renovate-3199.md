---
"@tailor-platform/sdk": patch
"@tailor-platform/create-sdk": patch
"@tailor-platform/sdk-codemod": patch
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-setup": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Update `@politty/zod` to 0.7.5, so a lone `-` after an option that takes a value, such as `--value -`, is read as its value instead of being rejected
