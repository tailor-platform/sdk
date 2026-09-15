---
"@tailor-platform/create-sdk": patch
---

Add `"ESNext.Temporal"` to the generated project templates' `tsconfig.json` `lib`, so `t.date({ as: "temporal" })` type-checks out of the box in a scaffolded project.
