---
"@tailor-platform/sdk": patch
---

OAuth2 client names in `defineAuth()` `oauth2Clients` must now be 3 to 63 lowercase letters, digits, or hyphens, starting and ending with a letter or digit, and the config fails to load otherwise. The platform already rejects such a name, so `deploy` used to fail partway, after creating other resources; rename the client to deploy or remove the application. A config key that breaks a naming rule, such as an OAuth2 client name, is now reported with that rule instead of `Invalid key in record`.
