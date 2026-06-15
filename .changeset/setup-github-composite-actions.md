---
"@tailor-platform/sdk": patch
---

`setup github` now generates workflows that call the `tailor-platform/actions`
composite actions (`setup`, `generate-check`, `tag-guard`) instead of inlining
the equivalent steps. The generated workflows are smaller and the setup,
generate-check, and tag-guard behavior is delivered through the pinned actions.
