---
"@tailor-platform/sdk": patch
---

Fix deploy reporting spurious updates on every run: TailorDB types no longer drift when the platform proto gains new fields, IdP services without an explicit userAuthPolicy no longer drift against the platform's default password policy, and deploys with pending migrations no longer silently skip type changes in namespaces that have no migrations
