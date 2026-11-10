---
"@tailor-platform/sdk": patch
---

Report an invalid resolver `defaultPermission` as `CONFIG_INVALID`. The error is located at the config file and lists each issue with its path, such as `resolver.main.defaultPermission.0.conditions.0.0`, in the message and in `context.issues` under `--json`; it used to be an `UNEXPECTED_ERROR` with the issues joined into one line.
