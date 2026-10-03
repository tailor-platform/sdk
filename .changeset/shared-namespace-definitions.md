---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Read TailorDB definitions from another application's local `tailor.config.ts` through `db.<namespace>.schemaFrom`. Generation plugins receive referenced definitions separately from owned tables, and `kyselyTypePlugin` includes them in generated types and PGlite schemas. Use `attach: false` to generate artifacts without adding the namespace to the application's GraphQL API.

Use `attach: true` for existing TailorDB, resolver, auth, and IdP services. Deprecate `external: true` while preserving compatibility until v3, with a codemod to migrate existing configurations. Keep local ERD generation and file watching scoped to owned namespaces.

Reject inferred SQL queries when a table name matches multiple configured namespaces, preventing config order from selecting the wrong database.
