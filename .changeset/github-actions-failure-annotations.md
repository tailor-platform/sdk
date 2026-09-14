---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-seed": minor
---

Surface command failures as GitHub Actions annotations. When `GITHUB_ACTIONS=true`, a failing command writes one `::error::` workflow command carrying the error code, details, suggestion, and next action, so the failure shows on the run instead of only in the scrolled log. Set `TAILOR_GITHUB_ACTIONS_ANNOTATIONS=false` to turn it off; `--json` suppresses it.
