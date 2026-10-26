---
"@tailor-platform/sdk": patch
---

`tailor-sdk deploy` keeps restoring a missing IdP client secret vault with the client's secret after an SDK upgrade, once the platform stops returning secrets when listing clients.
