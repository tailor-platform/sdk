---
"@tailor-platform/sdk": patch
---

Resolver bundles no longer include the code that converts `Date` and `Temporal` output values to strings unless the resolver's output has a `date`, `datetime`, or `time` field declared with `as: "date"` or `as: "temporal"`, making bundles of other resolvers smaller.
