---
"@tailor-platform/sdk": patch
---

The notification banner now uses your stored login when `TAILOR_PLATFORM_TOKEN` is set to an empty value (for example `TAILOR_PLATFORM_TOKEN=` in an `--env-file`), as commands already did, instead of sending an empty token and showing no notifications.
