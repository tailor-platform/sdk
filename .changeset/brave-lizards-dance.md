---
"@tailor-platform/sdk": minor
---

Add support for configuring GraphQL operations on TailorDB types

- Add `gqlOperations` option to `.features()` for granular control (true = enabled, false = disabled)
- Add `.gqlMutations(enabled)` method to enable/disable all mutations (create/update/delete) for a single type
- Add `gqlMutations` option to `TailorDBServiceConfig` to enable/disable mutations for all types in a namespace
- Regenerate proto definitions from latest `tailor-inc/proto`
