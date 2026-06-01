---
"@tailor-platform/sdk": patch
---

Route `workflowJob.trigger()` and `workflow.trigger()` through the `globalThis.tailor.workflow` mock in the `tailor-runtime` Vitest environment, matching the existing wait/resolve mock pattern. Triggered payloads now pass through the same JSON serialization boundary as the real Platform, so tests catch `NaN` / `Infinity` / `BigInt` / class-instance values that the Platform would reject. A workflow's main job invoked via `workflow.trigger()` now also appears in `workflowMock.triggeredJobs` and honors `setJobHandler` / `enqueueResult` uniformly with other jobs.
