---
"@tailor-platform/sdk": patch
---

Run `tailor query --engine gql` requests directly from the CLI instead of a server-side script execution. Machine user access tokens no longer leave the CLI as part of a script-execution request, and GraphQL queries are no longer subject to the server-side script execution deadline. Note that the CLI now connects to the application's GraphQL endpoint directly: applications restricting client IPs with `allowedIpAddresses` require the CLI's IP address to be in the allowlist (previously the query was sent from inside the platform, so the restriction never evaluated the caller's IP address).
