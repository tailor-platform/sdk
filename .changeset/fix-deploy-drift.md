---
"@tailor-platform/sdk": patch
---

Fix deploy reporting spurious TailorDB type updates on every run when the platform proto gains new fields, and fix deploys with pending migrations silently skipping type changes in namespaces that have no migrations
