---
"@tailor-platform/sdk": patch
---

Accept IdP `userAuthPolicy.allowedEmailDomains: ["*"]`, the lone entry that allows every email domain. `tailor-sdk deploy` used to reject it with "must be a valid hostname" during pre-flight validation because the bundled protobuf descriptors carried the platform's older hostname-only rule. Each entry is now validated locally: it must be a hostname or `"*"`, entries must be unique when compared case-insensitively and number at most 100, and `"*"` cannot sit alongside another entry.

`tailor-sdk deploy` also warns on an IdP service that leaves `allowedEmailDomains` empty. An empty list still allows every domain, but a future platform release requires that state to be explicit, so set `["*"]` to keep the current behavior or list the domains you accept.

Fixes a plan diff that re-applied `allowedEmailDomains` on every deploy when an entry was written in mixed case.
