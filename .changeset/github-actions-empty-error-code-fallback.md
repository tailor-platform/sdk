---
"@tailor-platform/sdk": patch
---

Fix GitHub Actions annotation titles falling back to `CLI_ERROR` only when a `CLIError`'s `code` is empty, not just when it is missing.
