---
"@tailor-platform/sdk": patch
---

When an executor with an `authAccessToken` trigger is in a config without Auth, `tailor deploy` now names the executor and the config file in the `AUTH_CONFIG_REQUIRED` error, and suggests defining Auth in that config or referencing an existing Auth service as external.
