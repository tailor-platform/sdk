---
"@tailor-platform/sdk": minor
---

feat(auth): expose `env` in the `beforeLogin` hook handler

The `beforeLogin` auth hook handler now receives `env` alongside `claims` and `idpConfigName`, exposing the variables defined in `defineConfig({ env })` (the same values available via `context.env` in resolvers). This lets hooks branch on environment-specific configuration at runtime without relying on `process.env`, which is unavailable in the platform runtime.
