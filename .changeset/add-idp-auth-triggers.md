---
"@tailor-platform/sdk": patch
---

Add IdP and Auth event triggers for executor

New trigger functions:

- `idpUserCreatedTrigger()` - fires when an IdP user is created
- `idpUserUpdatedTrigger()` - fires when an IdP user is updated
- `idpUserDeletedTrigger()` - fires when an IdP user is deleted
- `authAccessTokenIssuedTrigger()` - fires when an access token is issued
- `authAccessTokenRefreshedTrigger()` - fires when an access token is refreshed
- `authAccessTokenRevokedTrigger()` - fires when an access token is revoked
