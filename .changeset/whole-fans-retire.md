---
"@tailor-platform/sdk": minor
---

Add an `auth` option to the authAccessToken triggers (`authAccessTokenIssuedTrigger({ auth: "my-auth" })` and the others) that names the Auth service the trigger subscribes to. It must name the Auth service the config uses; `deploy` fails for any other name.
