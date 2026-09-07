---
"@tailor-platform/sdk": patch
---

Validate IdP `userAuthPolicy.allowedEmailDomains` locally and document `["*"]`, the lone entry that allows every email domain and the only way to enable `allowGoogleOauth` or `allowMicrosoftOauth` without enumerating domains. Each entry must be a hostname or `"*"`, entries must be unique when compared case-insensitively and number at most 100, and `"*"` cannot sit alongside another entry. These were already rejected on deploy, so they now surface before the apply instead of during it.

`tailor deploy` also warns on an IdP service that leaves `allowedEmailDomains` empty. An empty list still allows every domain, but a future platform release requires that state to be explicit, so set `["*"]` to keep the current behavior or list the domains you accept.

Fixes a plan diff that re-applied `allowedEmailDomains` on every deploy when an entry was written in mixed case.
