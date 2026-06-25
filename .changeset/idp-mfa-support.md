---
"@tailor-platform/sdk": minor
---

Add MFA support to `defineIdp`. The `userAuthPolicy` now accepts `enableMfa`, `requireMfa`, `allowedReturnOrigins`, and `mfaIssuer` to configure TOTP-based MFA for the Built-in IdP. `permission.unenrollMfa` controls who can unenroll a user's MFA factor. Static-website `:url` placeholders are accepted in `allowedReturnOrigins` and resolved at deploy time.
