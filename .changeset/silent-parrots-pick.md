---
"@tailor-platform/sdk": patch
---

Document the `scim` and `publishSessionEvents` options of `defineAuth`. Executors with an `authAccessToken*` trigger run only while their Auth service sets `publishSessionEvents: true`, which `deploy` does not enable for them.
