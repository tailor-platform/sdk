---
"@tailor-platform/eslint-plugin-sdk": minor
"@tailor-platform/create-sdk": minor
---

Add a lint rule (`no-plain-tailor-any-field-param`) that flags a function parameter typed with `TailorAnyField` itself, such as `field: TailorAnyField` or `fields: Record<string, TailorAnyField>`, which turns the output type of each field passed to it into `any`; constrain a type parameter instead, such as `<F extends TailorAnyField>(field: F)`. Enabled in newly scaffolded projects.
