---
"@tailor-platform/sdk": patch
---

Stop `tailor deploy` from planning an IdP update for `allowedEmailDomains` entries that differ only in letter case. The platform lowercases domains before storing them, so a mixed-case entry was re-applied on every deploy.
