---
"@tailor-platform/sdk": patch
---

Hide secrets in CLI log output and `--json` error output when only part of the value is highlighted, and in progress spinner lines. Values the CLI masks as `<redacted>`, such as client secrets and access tokens, appeared unmasked in these cases. `--json` error output no longer includes color codes in its string values.
