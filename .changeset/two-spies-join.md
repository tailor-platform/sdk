---
"@tailor-platform/sdk": patch
---

`tailor deploy` and `tailor remove` now also stop with `SERVICE_IN_USE` before they change anything when they would delete an IdP that another application references as `external`, as they already do for a TailorDB namespace, resolver namespace, or Auth service. Before, they deleted the IdP without an error or warning, which left the referencing application pointing at an IdP that no longer exists. For `tailor deploy`, keep the IdP in the config that defines it, or deploy the referencing applications without it first or in the same `deploy`. For `tailor remove`, first remove the referencing applications or deploy them without it.
