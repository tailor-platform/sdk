---
"@tailor-platform/sdk": minor
---

Make function bundles smaller by leaving out code they do not use:

- Resolver bundles no longer include the code that converts `Date` and `Temporal` output values to strings unless the resolver's output has a `date`, `datetime`, or `time` field declared with `as: "date"` or `as: "temporal"`.
- Bundles that do not define TailorDB tables no longer include the TailorDB schema builders and their deep-clone dependency.

Add `parseDateFields` to `@tailor-platform/sdk/runtime`. It parses a value like `field.parse` and always converts fields declared with `as: "date"` or `as: "temporal"`.
