---
"@tailor-platform/sdk": patch
---

Stop printing the access and refresh tokens stored in `~/.config/tailor-platform/config.yaml` when the file has a YAML syntax error. The CLI now reports `PLATFORM_CONFIG_INVALID` with the line and column of the error, and reports an empty file as `PLATFORM_CONFIG_INVALID` again instead of `UNEXPECTED_ERROR`.
