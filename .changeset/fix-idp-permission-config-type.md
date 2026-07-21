---
"@tailor-platform/sdk": patch
---

Fix `IdPConfig`'s `permission` type so `defineIdp` calls with valid permission definitions using project-specific attribute keys are no longer rejected by `tsc`
