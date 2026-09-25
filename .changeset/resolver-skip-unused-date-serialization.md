---
"@tailor-platform/sdk": minor
---

Make function bundles smaller by leaving out code they do not use:

- Resolver bundles only include the code that converts `Date` and `Temporal` values for the representations (`as: "date"` or `as: "temporal"`) the resolver's `input` and `output` fields use. A resolver without such fields includes neither.
- Bundles that do not define TailorDB tables no longer include the TailorDB schema builders and their deep-clone dependency.

Add `parseDateFields` to `@tailor-platform/sdk/runtime`. It parses a value like `field.parse` and always converts fields declared with `as: "date"` or `as: "temporal"`. Inside a resolver `body`, calling `.parse()` on a field whose representation the resolver's `input` and `output` do not use now throws an error pointing to `parseDateFields`; use `parseDateFields` there instead.
