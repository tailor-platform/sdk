---
"@tailor-platform/sdk": patch
---

Follow the Platform API for IdP. Its list response for IdP clients no longer carries a client secret, and it now carries the rule that `userAuthPolicy.allowedEmailDomains` must be set, which `tailor deploy` already checked. `tailor deploy` behaves as before and still reports a missing `allowedEmailDomains` once.
