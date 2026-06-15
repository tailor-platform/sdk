---
"@tailor-platform/sdk": patch
---

Fix profile-based token resolution being ignored by some commands. The CLI documents that the access token resolves from `--profile`, then `TAILOR_PLATFORM_PROFILE`, then the current login, but `tailordb migration set`/`status` and the `organization` commands skipped profile resolution and always used the current login — pairing one profile's workspace with another user's token. All commands now follow the documented order.
