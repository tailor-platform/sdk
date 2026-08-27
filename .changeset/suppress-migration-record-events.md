---
"@tailor-platform/sdk": patch
---

Make migrating TailorDB namespaces read-only and stop publishing their record events while migrations run. `deploy` disables GraphQL create, update, delete, and bulk-upsert operations while preserving each table's active read access. A successful migration applies the configured settings. If a later migration fails, settings from the last confirmed checkpoint are restored; an uncommitted migration restores existing tables' prior settings and leaves its newly created tables restricted until a successful retry. Restoration rechecks the checkpoint number and history so it does not overwrite a concurrently completed deployment.
