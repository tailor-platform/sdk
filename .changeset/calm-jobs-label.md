---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": patch
---

Workflow job executions now carry `kind` (the job function name, or the key of a wait) and `position` (parent job, call order, parallel branch, depth) in the `jobDetails` of `getWorkflowExecution({ logs: true })` and of the `wait()` it returns, and in the matching `--json --logs` output of `tailor workflow executions`, `wait`, `start --wait` and `resume --wait`. `workflowJobLogs[]` of `watchExecutorJob()` and `tailor executor jobs --wait --logs` gains `kind` and `jobExecutionId`. `stackedJobName` and `workflowJobLogs[].jobName` keep their values, are deprecated in favor of the new fields, and will be removed in v3.

In its human-readable output the CLI now names a job by its job function name, or `wait(<key>)` for a wait, where it used to print `stackedJobName`. This applies to the job headings printed with `--logs` and to the active jobs listed while a command waits. Two executions of the same job function share a name, so the headings also show the job execution id.
