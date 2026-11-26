---
"@tailor-platform/sdk": minor
---

Add `as: "decimal"` to `t.decimal()`. Input is converted to a `Decimal` from decimal.js and a `Decimal` returned from the resolver is written as a plain-notation string without an exponent (for example `"0.0000001"`, not `"1e-7"`), so decimal arithmetic in a resolver keeps its precision. Without `as`, decimals remain strings. Import `Decimal` from `@tailor-platform/sdk/runtime` to construct values or name the type. A resolver bundle only includes decimal.js when its `input` or `output` declares a field with `as: "decimal"`, and `parseDecimalFields`, exported by `@tailor-platform/sdk/runtime`, parses decimal fields inside a resolver body. Values beyond the range the Platform stores are rejected.
