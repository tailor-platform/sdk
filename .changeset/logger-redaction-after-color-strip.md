---
"@tailor-platform/sdk": patch
---

Hide secrets in CLI log output when only part of the value is highlighted, and in progress spinner lines. Values the CLI masks as `<redacted>`, such as client secrets and access tokens, appeared unmasked in these cases.
