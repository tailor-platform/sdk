---
"@tailor-platform/sdk": patch
---

fix: e2e tests incorrectly counting resources when multiple apps exist in workspace

Fixed an issue where e2e tests counted resources from other applications in the same workspace.

- Add metadata filtering by `sdk-name` label in e2e tests
- Set metadata on JobFunctions during apply and remove when no longer used
