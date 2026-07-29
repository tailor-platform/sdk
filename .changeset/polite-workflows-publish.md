---
"@tailor-platform/sdk": minor
---

Add Executor triggers for workflow and workflow job execution lifecycle events, with typed event arguments. Subscribing to these events is enough to receive them. `deploy` enables `publishEvents` on each targeted workflow, and on every job of a workflow targeted by a `workflowJobExecution*` trigger. Set `publishEvents` on `createWorkflow` / `createWorkflowJob` to publish without a subscribing executor, or to keep publishing off.
