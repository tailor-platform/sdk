---
"@tailor-platform/sdk": patch
---

Fix GitHub Actions annotation titles to fall back to `CLI_ERROR` when a `CLIError`'s `code` is an empty string, not only when it is missing entirely.
