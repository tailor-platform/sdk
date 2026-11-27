---
"@tailor-platform/sdk": minor
---

Add `defaultDecimalRepresentation: "decimal"` to `defineConfig()`, so `t.decimal()` fields that omit `as` carry `Decimal` values from decimal.js, as `as: "decimal"` gives them. A field's own `as` still wins, and `as: "string"` keeps one field a string. The setting applies in every bundled function, in `tailor function run`, and in the `tailor-runtime` Vitest environment; TailorDB fields are not affected. Run `tailor generate` after changing it so `tailor.d.ts` updates the field types, which now also record a `DecimalRepresentationRegistry`; when the `tailor.d.ts` files of several applications in one program disagree, `t.decimal()` called without `as` fails to type-check.
