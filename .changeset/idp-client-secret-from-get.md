---
"@tailor-platform/sdk": patch
---

`tailor deploy` no longer reads an IdP client's `clientSecret` from the list response. When a deploy forced by an SDK version change finds that an IdP client's secret vault is missing, it now fetches the client with `getIdPClient` and creates the secret from that value. This keeps the deploy working when the platform stops returning `clientSecret` from the list API.
