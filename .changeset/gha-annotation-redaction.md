---
"@tailor-platform/sdk": patch
---

Hide secrets in the GitHub Actions `::error::` annotation a failed command writes. Values the CLI already masks as `<redacted>` in its log output, such as client secrets and access tokens, appeared unmasked in the annotation when they were part of the error.
