---
"@tailor-platform/sdk": patch
---

feat(vitest): run a full workflow locally through `.trigger()` (Beta)

With a `using wf = mockWorkflow()` acquired, calling `workflow.mainJob.trigger()`
(or any job's `.trigger()`) runs the real job bodies of the whole chain, so you
can exercise end-to-end orchestration in a unit test without a deployment.
Trigger inputs and outputs cross the same JSON boundary the platform uses, so a
non-serializable payload fails the test exactly as it would in production.
Override individual dependent jobs with `wf.setJobHandler(...)` /
`wf.enqueueResult(...)` while the rest run their real bodies.
