---
"@tailor-platform/sdk": patch
---

Add schema validation to reject `requireDpop: true` for browser client type in OAuth2 client configuration. Browser clients don't support DPoP, and this validation provides early feedback at the SDK level before deployment.
