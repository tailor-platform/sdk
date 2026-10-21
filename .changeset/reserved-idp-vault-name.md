---
"@tailor-platform/sdk": patch
---

`tailor deploy` now fails when a vault declared in `defineSecretManager()` has the same name as the vault the SDK creates for one of the application's IdP clients (`idp-<namespace>-<client>`), because the two would share one vault and the built-in IdP configuration in Auth could read the wrong secret.

A vault that an IdP client uses is also no longer deleted when it is removed from `defineSecretManager()`, so renaming a declared vault to resolve the conflict does not delete the IdP client's secret.

Deleting a Secret Manager vault or secret that no longer exists no longer fails the deploy.
