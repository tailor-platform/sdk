---
"@tailor-platform/sdk": minor
"@tailor-platform/create-sdk": minor
---

Add local testing support for workflows

- `createWorkflowJob`: `.trigger()` now executes body directly for local testing
- `createWorkflow`: `.trigger()` now calls `mainJob.trigger()` for local testing
- Export `WORKFLOW_TEST_ENV_KEY` from `@tailor-platform/sdk/test` for env configuration
- Add workflow trigger test examples to testing template
