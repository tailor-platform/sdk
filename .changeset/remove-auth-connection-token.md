---
"@tailor-platform/sdk": major
---

Remove the deprecated `auth.getConnectionToken()` helper from values returned by `defineAuth()`. Use `authconnection.getConnectionToken(...)` from `@tailor-platform/sdk/runtime` in resolvers, executors, and workflows instead.
