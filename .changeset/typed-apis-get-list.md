---
"@tailor-platform/sdk": minor
---

Add typed API overloads to get/list/executions/jobs CLI commands

- Add definition-object-based overloads to `getWorkflow`, `getExecutor`, `listExecutorJobs`, `getExecutorJob`, `watchExecutorJob`, and `listWorkflowExecutions`
- Export new typed options: `GetWorkflowTypedOptions`, `GetExecutorTypedOptions`, `ListExecutorJobsTypedOptions`, `GetExecutorJobTypedOptions`, `WatchExecutorJobTypedOptions`, `ListWorkflowExecutionsTypedOptions`
- Deprecate existing string-based options in favor of typed alternatives (backward compatible)
