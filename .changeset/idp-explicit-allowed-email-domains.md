---
"@tailor-platform/sdk": minor
---

Support `allowedEmailDomains: ["*"]` on IdP `userAuthPolicy` to allow every email domain, which is the only way to enable `allowGoogleOauth` or `allowMicrosoftOauth` without enumerating domains. `allowedEmailDomains` entries are now validated locally: each must be a hostname or `"*"`, entries must be unique and number at most 100, and `"*"` cannot be combined with another entry.

An empty `allowedEmailDomains` still allows every domain, but a future platform release requires that state to be explicit. `tailor deploy` now warns on an IdP service that leaves it empty, so set `["*"]` to keep the current behavior or list the domains you accept.
