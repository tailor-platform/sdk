---
"@tailor-platform/sdk": patch
---

Fix CI race condition where concurrent PR runs delete each other's e2e workspaces by scoping cleanup to the current GitHub Actions run ID
