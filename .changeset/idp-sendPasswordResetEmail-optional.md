---
"@tailor-platform/sdk": minor
---

Make `defineIdp({ permission: { sendPasswordResetEmail } })` conditionally required. When `userAuthPolicy.disablePasswordAuth` is `true`, password authentication is off and the password-reset email flow can never run, so the field is now optional in that case (still required otherwise). Omitting the field when it is optional behaves as deny-all.
