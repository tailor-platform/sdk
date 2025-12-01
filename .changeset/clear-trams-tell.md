---
"@tailor-platform/sdk": patch
---

Added oauth2client commands

Added commands to retrieve OAuth2 client credentials (clientId and clientSecret) after deployment.
For security, clientSecret is only shown in the `get` command.

```sh
tailor-sdk oauth2client list
tailor-sdk oauth2client get <name>
```
