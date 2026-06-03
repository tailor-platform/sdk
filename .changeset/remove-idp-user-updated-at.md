---
"@tailor-platform/sdk": patch
---

fix(runtime): remove non-existent `updatedAt` field from `idp.User`. The IDP service does not return this field, so the declaration was misleading consumers into expecting an optional timestamp that was always `undefined`.
