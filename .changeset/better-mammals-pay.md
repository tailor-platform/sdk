---
"@tailor-platform/sdk": patch
---

Fix `tailor workflow executions` and `listWorkflowExecutions()` failing when no workflow is given. They now list the executions of every workflow in the workspace.
