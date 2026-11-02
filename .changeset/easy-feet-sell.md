---
"@tailor-platform/sdk": patch
---

`tailor deploy` now reads its config paths from `TAILOR_CONFIG_PATH`, as the other commands do. It accepts comma-separated paths there, and `--env-file` can set it. `TAILOR_PLATFORM_SDK_CONFIG_PATH` still works when `TAILOR_CONFIG_PATH` is not set, with a deprecation warning; rename it to `TAILOR_CONFIG_PATH`.
