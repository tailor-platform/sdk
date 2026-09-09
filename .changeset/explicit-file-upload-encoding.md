---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": patch
---

Add explicit `utf8` and `base64` encoding options to `file.upload` and generated `uploadFile` helpers. String uploads without encoding retain their existing text behavior but are deprecated ahead of v3; byte uploads remain unchanged and are not deprecated. Include migration guidance for existing string uploads.
