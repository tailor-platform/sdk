---
"@tailor-platform/sdk": patch
---

Fix `deploy` failing to restore GraphQL operation restrictions after a TailorDB migration, when a table outside the local migration snapshot has a partially-set `disableGqlOperations` record on the platform. The restore step now normalizes missing fields to `false` instead of forwarding them unset, which previously made the platform reject the request and left the original migration error unrecovered.
