---
"@tailor-platform/sdk": patch
---

Hide secrets that contain a line break or a quote in CLI errors and suggested commands. Values the CLI masks as `<redacted>`, such as client secrets and access tokens, appeared unmasked in multi-line error details and suggestions, in suggested commands, and in the matching GitHub Actions annotation.
