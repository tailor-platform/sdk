---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": patch
---

Workflow job executions now carry `kind` (the job function name, or the key of a wait) and `position` (parent job, call order, parallel branch, depth) in the `jobDetails` of `getWorkflowExecution({ logs: true })` and of the `wait()` it returns, and in the matching `--json --logs` output of `tailor workflow executions`, `wait`, `start --wait` and `resume --wait`. `stackedJobName` is deprecated in favor of them and will be removed in v3.

The CLI names a job by its job function name, or `wait(<key>)` for a wait, where it used to print `stackedJobName`. This applies to the job headings printed with `--logs` by those workflow commands, the active jobs listed while a workflow command waits, and `workflowJobLogs[].jobName` of `tailor executor jobs --wait --logs`. Two executions of the same job function now share a name, so the headings also show the job execution id, and `workflowJobLogs[]` has a new `jobExecutionId`.
