---
"@tailor-platform/sdk": patch
---

Fix `tailordb migration set` accepting invalid or out-of-range checkpoint numbers. Numbers above 9999 wrote a label the SDK later reads back as "no checkpoint", silently marking every migration as pending again; malformed input like `1abc` was truncated to its leading digits; and numbers beyond the latest local migration were accepted without validation. The command now uses the same strict argument parsing as `migration script`/`migration sync` and rejects numbers that do not exist in the local migration history (`0` remains valid as the baseline).

Also, `tailordb migration status` and `migration set` no longer render metadata lookup failures (authentication, permission, or network errors) as "all migrations pending": only a not-yet-deployed namespace reads as checkpoint `0000`, and every other error propagates.
