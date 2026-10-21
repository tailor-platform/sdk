---
"@tailor-platform/sdk": patch
---

`tailor deploy` now fails when a vault declared in `defineSecretManager()` has the same name as the vault the SDK creates for one of the application's IdP clients (`idp-<namespace>-<client>`), because the two would share one vault and the built-in IdP configuration in Auth could read the wrong secret.
