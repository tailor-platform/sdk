---
"@tailor-platform/sdk": patch
---

`tailor deploy` no longer clears an Auth service's `tenantProvider` when redeploying the Auth service, or plans an unchanged `tenantProvider` as an update on every run. The next deploy restores a `tenantProvider` that an earlier redeploy cleared.
