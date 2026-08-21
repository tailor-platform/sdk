---
"@tailor-platform/sdk": patch
---

Cancel the internal upload timeout timer in `tailor staticwebsite deploy` once each upload settles, so finished deploys no longer hold the process open for the remaining timeout when the CLI is used programmatically.
