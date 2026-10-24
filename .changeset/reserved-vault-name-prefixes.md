---
"@tailor-platform/sdk": patch
---

`tailor deploy` now warns when a vault declared in `defineSecretManager()` has a name that starts with `tailor--` (two hyphens, so that names such as `tailor-reports` stay free). The prefix is reserved in advance for the platform and has no use today. The warning does not stop the deploy, and these names will be rejected in v3.
