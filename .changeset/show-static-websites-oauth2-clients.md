---
"@tailor-platform/sdk": minor
---

`tailor show` (and the programmatic `show()`) now also lists each deployed static website defined in `staticWebsites` with its URL and description, and each deployed OAuth2 client defined in `auth`'s `oauth2Clients` with its client ID, so a CI step can read both from one `tailor show --json` call right after `tailor deploy`. Client secrets are never included, and credentials that cannot list OAuth2 clients get a warning and an empty list instead of a failure.
