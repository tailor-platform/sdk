---
"@tailor-platform/sdk": minor
---

`tailor show` (and the programmatic `show()`) now also lists each deployed static website defined in `staticWebsites` with its URL and description, and each deployed OAuth2 client defined in `auth`'s `oauth2Clients` with its client ID, so a CI step can read both from one `tailor show --json` call right after `tailor deploy`. Client secrets are never included. Credentials that cannot list OAuth2 clients, such as the workspace viewer role, get a warning and an empty list of OAuth2 clients.
