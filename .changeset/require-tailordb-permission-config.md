---
"@tailor-platform/sdk": patch
---

Fail fast at `generate`/`deploy` time when a TailorDB type is missing `.permission()`, or missing `.gqlPermission()` while GraphQL operations are enabled for it (`.gqlPermission()` is not required when GraphQL exposure is fully disabled via `gqlOperations`). Previously these omissions deployed silently and only surfaced later as an opaque `internal error` on insert.
