---
"@tailor-platform/sdk": minor
---

Add `maintenanceMode` to `defineConfig()` to choose whether `tailor deploy` restricts the TailorDB namespaces it migrates while pending migrations run. `"migration"` restricts them (no generated GraphQL operations, no record events) until the migrations complete, as every deploy did before; `"deploy"` keeps them restricted until the deploy has also applied resolvers, executors, and workflows, so executors from the previous deploy never receive events from the migrated tables; `false` does not restrict them.

The default is now `false`: a deploy no longer restricts migrating namespaces unless the config sets `maintenanceMode`, and it warns when migrations are pending and the option is unset. Set `maintenanceMode: "migration"` to keep the previous behavior.

Tables that a deploy left restricted after its migrations completed, for example because the deploy was interrupted, no longer make the next deploy stop with remote schema drift; a later deploy that completes releases them.
