---
"@tailor-platform/sdk": minor
---

Handle OAuth2 client type changes with delete-recreate

OAuth2 clients cannot update their clientType in-place on the server. This change detects clientType changes and handles them as replace operations (delete then create) during the create-update phase. Also adds deletion warnings for OAuth2 clients similar to TailorDB types and StaticWebsites.
