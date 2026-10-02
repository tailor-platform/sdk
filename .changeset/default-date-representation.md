---
"@tailor-platform/sdk": minor
---

Add `defaultDateRepresentation` to `defineConfig()` to set the value representation (`"string"`, `"date"`, or `"temporal"`) of `t.date()`, `t.datetime()`, and `t.time()` fields that omit `as`. The generated `tailor.d.ts` applies it to field types, and deployed resolvers, `tailor function run`, and the `tailor-runtime` Vitest environment apply it when converting resolver input and output. A field's own `as`, including `as: "string"`, takes precedence.
