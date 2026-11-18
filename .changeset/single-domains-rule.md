---
"@tailor-platform/sdk": patch
---

`tailor deploy` keeps reporting an IdP whose `userAuthPolicy` leaves `allowedEmailDomains` empty once. The Platform API now carries the same rule, which would have listed the same problem twice.
