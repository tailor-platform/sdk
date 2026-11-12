---
"@tailor-platform/sdk": patch
---

`tailor deploy` now fails before it applies any change when it would create or update an IdP whose `allowedEmailDomains` is empty or omitted and `useNonEmailIdentifier` is not `true`, and `tailor deploy --dry-run` fails on such a plan too. Deploy used to create or update the secrets, static websites, and AI gateways in the same run first and then fail on the IdP, which it still does with `--no-validate`.
