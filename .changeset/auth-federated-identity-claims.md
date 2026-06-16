---
"@tailor-platform/sdk": minor
---

Type the `federated_identity` claim in the `beforeLogin` hook. When a user signs in through a Built-in IdP OAuth provider (Google or Microsoft), `claims.federated_identity` now exposes the upstream provider's profile (`provider` plus profile claims such as `picture`, `name`, `given_name`, `family_name`, `locale`) with autocompletion, while arbitrary IdP claims remain reachable. Adds the `FederatedIdentity`, `FederatedIdentityClaims`, `FederatedIdentityProvider`, and `BeforeLoginClaims` types.
