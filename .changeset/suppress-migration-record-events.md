---
"@tailor-platform/sdk": patch
---

Make migrating TailorDB namespaces read-only and stop publishing their record events while migrations run. `deploy` disables GraphQL create, update, delete, and bulk-upsert operations while preserving each table's active read access. A successful migration applies the configured settings; a failed migration restores existing tables' pre-deploy settings and leaves newly created tables restricted until a successful retry.
