---
"@tailor-platform/sdk": patch
---

CLI plugins now receive the Tailor Platform context (token, platform URL, OAuth2 client ID, workspace, and user) when their arguments include `--env-file` or `--env-file-if-exists`. The context is resolved after loading the env files, the same way other `tailor` commands resolve it, so a token or workspace ID the files set is passed through and the rest comes from the active profile. `TAILOR_PLATFORM_USER` is no longer passed when the token comes from `TAILOR_PLATFORM_TOKEN`.
