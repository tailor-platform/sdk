---
"@tailor-platform/sdk": patch
"@tailor-platform/create-sdk": patch
---

Fix the deprecation notice on the generated `uploadFile` overload for string data without `encoding`: it now reads `since 2.15.0` instead of `since NEXT_RELEASE`. Run `tailor generate` to update existing helpers.
