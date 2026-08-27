---
"@tailor-platform/sdk": patch
---

Make migrating TailorDB namespaces read-only and stop publishing their record events while migrations run. `deploy` disables GraphQL mutations while preserving each table's configured read access, silences every publishing table, and restores both settings once the migrations settle or before reporting a failure.
