---
"@tailor-platform/sdk": patch
---

fix: correctly determine create/update for workflow job functions

Previously, the SDK used `hasExistingWorkflows` (based on workflow updates) to decide whether to use `createWorkflowJobFunction` or `updateWorkflowJobFunction`. This caused errors when renaming job functions, as renamed jobs were incorrectly sent to the update API which requires the job to already exist.

Now the SDK fetches the actual list of existing job function names via `listWorkflowJobFunctions` API and correctly uses:

- `createWorkflowJobFunction` for new job names (including renamed jobs)
- `updateWorkflowJobFunction` for existing job names
