---
"@tailor-platform/sdk": patch
---

Fail `tailor login` with a normal command error when preparing the authorization URL fails, instead of treating the failure as an SDK crash through an unhandled promise rejection.
