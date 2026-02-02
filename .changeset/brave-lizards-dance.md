---
"@tailor-platform/sdk": minor
---

Add support for configuring GraphQL operations on TailorDB types

- Add `gqlOperations` option to `.features()` for granular control (true = enabled, false = disabled)
- Add `"query"` alias for read-only mode: `gqlOperations: "query"` disables all mutations while keeping read enabled
- Add `gqlOperations` option to `TailorDBServiceConfig` for namespace-level defaults
- Regenerate proto definitions from latest `tailor-inc/proto`
