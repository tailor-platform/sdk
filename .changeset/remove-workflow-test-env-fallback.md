---
"@tailor-platform/sdk": major
---

Remove the deprecated workflow test env fallback. `WORKFLOW_TEST_ENV_KEY` is no longer exported, and `TAILOR_TEST_WORKFLOW_ENV` is no longer read when running workflows locally. Use `mockWorkflow().setEnv(...)` or pass `{ env }` to `runWorkflowLocally(...)` instead.
