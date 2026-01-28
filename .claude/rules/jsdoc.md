---
paths:
  - "packages/sdk/src/**/*.ts"
---

# JSDoc Parameter Rules (SDK)

- Do not use destructured parameters in function signatures; accept a single object param and destructure inside the function.
- Do not inline object param types; extract them into a named `type`/`interface`.
- If you need destructured params or inline object types, every property must be documented with `@param obj.prop` in JSDoc.
