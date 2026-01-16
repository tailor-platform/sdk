---
"@tailor-platform/sdk": patch
---

docs: improve TailorDB hooks and validation documentation

- Add practical examples using function arguments (value, data, user)
- Split hooks and validation sections into field-level and type-level subsections
- Clarify that field-level hooks have `data` as `unknown` type
- Add warnings that field-level and type-level configurations cannot coexist on the same field
