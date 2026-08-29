---
"@tailor-platform/sdk": patch
---

Lock migrating TailorDB namespaces and stop publishing their record events while migrations run. `deploy` disables every GraphQL operation — create, update, delete, read, and bulk upsert — on the affected tables. A successful migration applies the configured settings. If a later migration fails, settings from the last confirmed checkpoint are restored; an uncommitted migration restores existing tables' prior settings and leaves its newly created tables restricted until a successful retry. Restoration rechecks the checkpoint number and history so it does not overwrite a concurrent deployment; if ownership cannot be verified, or a committed table deletion fails, the affected tables remain locked for manual recovery.
