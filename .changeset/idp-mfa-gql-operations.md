---
"@tailor-platform/sdk": patch
---

Extend `defineIdp({ gqlOperations })` with two MFA-related operations: `requestMfaSettingsUrl` (the `_requestMfaSettingsUrl` query that issues an MFA self-service URL) and `unenrollMfa` (the `_unenrollMfa` mutation that removes a user's enrolled MFA factor). Both default to enabled. Setting `gqlOperations.unenrollMfa: false` also relaxes the `permission.unenrollMfa` requirement that would otherwise apply when `userAuthPolicy.enableMfa` is `true`. The `gqlOperations: "query"` shortcut now keeps `requestMfaSettingsUrl` enabled (it is a query) while disabling `unenrollMfa` along with the other mutations.
