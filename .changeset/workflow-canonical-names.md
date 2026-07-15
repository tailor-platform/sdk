---
"@tailor-platform/sdk": minor
---

Add canonical `tailor.workflow.*` names that mirror the public `tailor.v1` RPC vocabulary. The `startWorkflow`, `startJobFunction`, and `resumeWorkflowExecution` methods are now available on `tailor.workflow`, alongside `workflow.startWorkflow` / `workflow.startJobFunction` / `workflow.resumeWorkflowExecution` from `@tailor-platform/sdk/runtime`. The pre-alignment names (`triggerWorkflow`, `triggerJobFunction`, `resumeWorkflow`) continue to work as frozen aliases, but are now marked `@deprecated` so IDEs surface a hint to migrate to the canonical names.
