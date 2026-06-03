---
"@tailor-platform/sdk": patch
---

feat(vitest): run a full workflow locally through `.trigger()` (Beta)

Calling `workflow.mainJob.trigger()` (or any job's `.trigger()`) now runs the
real job bodies of the whole chain — no `mockWorkflow()` needed — so you can
exercise end-to-end orchestration in a unit test without a deployment. Trigger
inputs and outputs cross the same JSON boundary the platform uses, so a
non-serializable payload fails the test exactly as it would in production.
Acquire `mockWorkflow()` only to override individual dependent jobs with
`wf.setJobHandler(...)` / `wf.enqueueResult(...)` (the rest still run their real
bodies), set the env via `wf.setEnv(...)`, or assert on `wf.triggeredJobs`.
