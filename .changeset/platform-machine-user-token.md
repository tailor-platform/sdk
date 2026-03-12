---
"@tailor-platform/sdk": minor
---

Add `login --machineuser` flag for platform machine user authentication. Token is stored in platform config for automatic use by subsequent commands. Supports `--client-id` and `--client-secret` options with environment variable fallback (`TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID` / `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET`). Client secret is prompted securely when omitted.
