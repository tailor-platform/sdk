---
"@tailor-platform/create-sdk": patch
"@tailor-platform/sdk": patch
---

The platform now rejects creating or updating an IdP whose `allowedEmailDomains` is empty or omitted unless `useNonEmailIdentifier` is `true`, so `tailor deploy` fails on such an IdP. That includes an IdP deployed earlier, on the first deploy after upgrading the SDK, which updates every IdP. Add `allowedEmailDomains: ["*"]` to the IdP's `userAuthPolicy` (adding `userAuthPolicy` when the IdP has none) to keep allowing every email domain, or list the domains you accept. Newly scaffolded `executor`, `generators`, and `static-web-site` projects now set `["*"]`, the deploy warning about an empty list now says the platform rejects it, and the IdP docs describe the requirement.
