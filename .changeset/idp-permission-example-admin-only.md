---
"@tailor-platform/sdk": patch
"@tailor-platform/create-sdk": patch
---

Restrict the `defineIdp` permission examples in the docs, the `IdPPermission` JSDoc, the `example` project and the `static-web-site` template to an administrator role, and warn in the IdP docs that a `_loggedIn` policy lets every authenticated user read and change other users' login information and send password reset emails
