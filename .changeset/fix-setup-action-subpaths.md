---
"@tailor-platform/sdk": patch
---

Fix `tailor-sdk setup` generated workflows referencing `tailor-platform/actions` without the required sub-action path (e.g. `/setup`, `/deploy`), which broke generated GitHub Actions workflows after the v1.7.0 dependency bump.
