---
"@tailor-platform/sdk": patch
---

Workflow `.trigger()` calls under the `tailor-runtime` Vitest environment now validate their payloads the same way the Platform does: tests surface `NaN` / `Infinity` / `BigInt` / class-instance values that the Platform would reject, instead of silently passing. A workflow's main job triggered via `workflow.trigger()` is now also recorded in `workflowMock.triggeredJobs` and honors `setJobHandler` / `enqueueResult` like any other job.
