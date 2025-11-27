---
"@tailor-platform/sdk": minor
---

Add workflow service support

- Add `createWorkflow()` and `createWorkflowJob()` APIs for orchestrating multiple jobs
- Support job dependencies via `deps` array with type-safe access (hyphen names converted to underscores)
- Workflow must be default exported, all jobs must be named exports
