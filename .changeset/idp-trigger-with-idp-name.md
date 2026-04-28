---
"@tailor-platform/sdk": minor
---

Add an `idp` option to IdP user triggers (`idpUserCreatedTrigger`, `idpUserUpdatedTrigger`, `idpUserDeletedTrigger`, `idpUserTrigger`) so executors can subscribe to a specific IdP namespace. Previously, projects with multiple IdPs failed `apply` because the SDK could not decide which IdP an executor targeted; specify `idp: "my-idp"` to disambiguate, or omit it when the project defines a single IdP. The auto-configuration of `publishUserEvents` now applies only to IdPs that are actually targeted, and `publishUserEvents: false` on a targeted IdP is rejected with a clear error instead of a warning. The new `IdpName` type is narrowed to defined IdP names via the generated `tailor.d.ts` for compile-time validation.
