---
"@tailor-platform/sdk": patch
---

IdP client names in `defineIdp()` `clients` and in a built-in IdP `idProvider` must now be 3 to 63 lowercase letters, digits, or hyphens, starting and ending with a letter or digit, and the config fails to load otherwise. Before, a client with a name such as `c1` was created, but the platform refuses to read or delete it, so removing the client or its IdP failed every `deploy` and `remove`, and an Auth service that used it as its built-in IdP failed to deploy. Rename such a client in `clients` and `idp.provider()`: `deploy` then warns that the old client and its secret vault stay in the workspace instead of failing to delete them. Removing the whole IdP now deletes such a client and its secret vault along with it.
