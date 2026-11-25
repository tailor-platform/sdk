---
paths:
  - "packages/sdk/src/**/*.ts"
---

# JSDoc Parameter Rules (SDK)

- Do not use destructured parameters in function signatures; accept a single object param and destructure inside the function.
- Do not inline object param types; extract them into a named `type`/`interface`. `local/require-named-param-type` reports an object literal alone or with `| undefined | null`; intersections, arrays of literals, and callbacks passed inline are left to review.
- If you need destructured params or inline object types, every property must be documented with `@param obj.prop` in JSDoc.
