---
"@tailor-platform/eslint-plugin-sdk": minor
"@tailor-platform/create-sdk": minor
---

Add a lint rule (`no-plain-tailor-any-field-param`) that flags a helper parameter typed with `TailorAnyField` itself, such as `field: TailorAnyField` or `fields: Record<string, TailorAnyField>`. When the helper uses a field passed to it to build another field, such as with `t.object()`, that field's output type becomes `any`; constrain a type parameter instead, such as `<F extends TailorAnyField>(field: F)`. Enabled in newly scaffolded projects.
