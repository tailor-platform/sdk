---
"@tailor-platform/sdk": patch
---

All CLI commands now resolve the access token the same way: `--profile`, then `TAILOR_PLATFORM_PROFILE`, then the current login. Previously `tailordb migration set`/`status` and the `organization` commands ignored profiles when resolving the token, which could pair one profile's workspace with another user's token.
