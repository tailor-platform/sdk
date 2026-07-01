---
"@tailor-platform/sdk": minor
---

Narrow auth connection names when calling `getConnectionToken()` outside of `defineAuth()`. When you call `tailor.authconnection.getConnectionToken(...)` or `authconnection.getConnectionToken(...)` (imported from `@tailor-platform/sdk/runtime`), the connection name is now type-checked and autocompleted against the connections defined in `defineAuth()`'s `connections` field, and the resolved token is typed instead of `any`. Run `tailor-sdk generate` (or `deploy`) to refresh `tailor.d.ts` after defining new connections.

Deprecate `auth.getConnectionToken()` (the method on `defineAuth()`'s return value). Prefer `authconnection.getConnectionToken(...)` from `@tailor-platform/sdk/runtime` — it does not require importing `auth` from `tailor.config.ts` into runtime files, avoiding bundling config-layer (Node-only) dependencies, the same reasoning behind the existing `auth.invoker()` deprecation.
