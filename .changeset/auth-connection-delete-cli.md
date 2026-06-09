---
"@tailor-platform/sdk": minor
---

feat(cli): add `authconnection delete` and use it during deploy

`tailor authconnection delete` removes an auth connection entirely (configuration, secret, and tokens), complementing `authconnection revoke`, which only invalidates the active session and keeps the connection so it can be re-authorized. `deploy` now uses delete when it replaces or removes the auth connections it manages.
