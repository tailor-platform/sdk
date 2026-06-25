---
"@tailor-platform/sdk": patch
---

Expose Built-in IdP MFA management on the runtime `idp.Client`. The `User` records returned by `user`, `userByName`, `users`, `createUser`, and `updateUser` now include `mfaEnrolled` and `mfaFactorIds`, and `client.unenrollMfa({ userId, mfaFactorId })` removes a single enrolled factor (gated by the `unenrollMfa` IdP permission).
