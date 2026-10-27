---
"@tailor-platform/sdk": patch
---

Editor tooltips and `--help` now flag beta APIs. `**Beta:**` appears in the JSDoc of every `@tailor-platform/sdk/vitest` and `@tailor-platform/sdk/plugin` export, `definePlugins`, the plugin authoring types, `.plugin()` and `plugins` on tables, `maintenanceMode`, the TailorDB `migration` config, and the migration exports and `noSchemaCheck` / `migrationSkipSteps` deploy options of `@tailor-platform/sdk/cli`. `(beta)` appears in the descriptions of `tailordb migration`, `deploy --no-schema-check`, and `deploy --migration-skip-steps`.
