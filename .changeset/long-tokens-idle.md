---
"@tailor-platform/sdk": minor
---

OAuth2 clients can keep refresh tokens for up to 90 days. `refreshTokenLifetimeSeconds` in `oauth2Clients` now accepts up to 7776000 seconds (90 days), and the new `refreshTokenIdleLifetimeSeconds` (60 seconds to 30 days) expires a refresh token once it has not been used for that long. A `refreshTokenLifetimeSeconds` above 7 days requires `refreshTokenIdleLifetimeSeconds`, which must be between `accessTokenLifetimeSeconds` and `refreshTokenLifetimeSeconds`.
