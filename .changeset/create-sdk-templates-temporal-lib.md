---
"@tailor-platform/create-sdk": patch
---

Add `"ESNext.Temporal"` to the generated project templates' `tsconfig.json` `lib`, so date, datetime, and time fields using `as: "temporal"` type-check out of the box in a scaffolded project.
