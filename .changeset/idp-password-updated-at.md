---
"@tailor-platform/sdk": minor
---

Expose when a Built-in IdP user's password was last set. The runtime `idp.Client` `User` records now include `passwordUpdatedAt` (an ISO 8601 string, or `null` for users without a password), and the Auth `beforeLogin` hook claims are typed with `password_updated_at` (seconds since the Unix epoch), so applications can enforce their own password expiration.
