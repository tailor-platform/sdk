---
"@tailor-platform/sdk": minor
---

Workflow job executions now carry `kind` (the job function name, or the key of a wait) and `position` (parent job, call order, parallel branch, depth) in the `jobDetails` of `getWorkflowExecution({ logs: true })` and of the `wait()` it returns, and in the matching `--json --logs` output of `tailor workflow executions`, `wait`, `start --wait` and `resume --wait`. `workflowJobLogs[]` of `watchExecutorJob()` and `tailor executor jobs --wait --logs` gains `kind` and `jobExecutionId`. A job of a kind this SDK version does not know reports `kind` as `{ type: "unknown" }`.

`stackedJobName` in `jobDetails[]` and `jobName` in `workflowJobLogs[]` are no longer output. They held a path the Platform builds to address a job inside a run, whose format is not specified, and the Platform is retiring it. Both stay on the exported types as optional properties that are never set and are marked `@deprecated`, so TypeScript code that reads them keeps compiling but receives `undefined`; scripts that read them from the JSON output no longer find the keys. Read `kind` for the name, the job execution id (`id`, or `jobExecutionId` in `workflowJobLogs[]`) for a key, and `position` for the place among the other jobs.

In its human-readable output the CLI now names a job by its job function name, or `wait(<key>)` for a wait. This applies to the job headings printed with `--logs` and to the active jobs listed while a command waits. Two executions of the same job function share a name, so the headings also show the job execution id. A job of an unknown kind is named by its job execution id alone.
