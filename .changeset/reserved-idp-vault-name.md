---
"@tailor-platform/sdk": patch
---

`tailor deploy` now fails when a vault declared in `defineSecretManager()` has the same name as the vault the SDK creates for one of the application's IdP clients (`idp-<namespace>-<client>`), because the two would share one vault and the built-in IdP configuration in Auth could read a secret that was overwritten by the declared value. If the application already manages a vault with that name, renaming it and removing the declaration both delete the old vault and its secrets on the next deploy, including the secret of an IdP client that already exists, and the error says so.
