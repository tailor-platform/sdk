---
"@tailor-platform/sdk": patch
---

Fix `apply` plan for IdP services when `permission` is omitted. The platform returns an empty `IdPPermission` (all action arrays empty) for services without configured permission policies, while the SDK sent `undefined`. The diff logic now normalizes an all-empty permission message to `undefined` so repeated applies are idempotent instead of always reporting the service as updated.
