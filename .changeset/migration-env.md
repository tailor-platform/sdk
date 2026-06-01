---
"@tailor-platform/sdk": minor
---

feat(migration): expose `env` in migration scripts

The migration `main` function now receives an optional second argument `{ env }: MigrationContext` exposing the variables defined in `defineConfig({ env })` — the same values available via `context.env` in resolvers and `{ env }` in workflow jobs. The values are injected at bundle time and the `MigrationContext` type is exported from the generated `./db`. Existing `main(trx)` scripts continue to work unchanged.
