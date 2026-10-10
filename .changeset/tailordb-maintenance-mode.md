---
"@tailor-platform/sdk": minor
---

Add `maintenanceMode` to `defineConfig()` to choose whether `tailor deploy` restricts the TailorDB namespaces it migrates while pending migrations run. `"migration"` restricts them (no generated GraphQL create, update, delete, or bulk upsert, and no record events) until the migrations complete, as every deploy did before; `"deploy"` keeps them restricted until the deploy has also applied resolvers, executors, and workflows, so executors from the previous deploy do not receive events from the migrated tables while the deploy replaces them; `false` does not restrict them.

The default is now `false`: a deploy no longer restricts migrating namespaces unless the config sets `maintenanceMode`, and it warns when migrations are pending and the option is unset. Set `maintenanceMode: "migration"` to keep the previous behavior.

Tables that a deploy left restricted after its migrations completed, for example because the deploy was interrupted, no longer make the next deploy stop with remote schema drift; that deploy releases them when it applies its TailorDB changes.

Restoring table settings after a failed migration no longer fails for a table whose checkpoint sets `publishEvents: false` while an executor in the same deploy subscribes to it, which left that table restricted.
