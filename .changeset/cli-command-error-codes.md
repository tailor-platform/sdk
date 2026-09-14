---
"@tailor-platform/sdk": patch
---

Report a stable `error.code` with recovery guidance for user-actionable CLI command failures (invalid options, missing resources, invalid configuration, unmet preconditions): `--json` output no longer falls back to `UNEXPECTED_ERROR` for them, and human-readable output prints the code with its suggestion and next command.
