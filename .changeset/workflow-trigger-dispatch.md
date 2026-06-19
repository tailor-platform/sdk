---
"@tailor-platform/sdk": major
---

Align workflow job `.trigger()` with the platform runtime. Job triggers now require a mocked workflow runtime in tests instead of running job bodies locally, and `trigger()` returns the job result directly instead of a Promise wrapper. Use `mockWorkflow()` to mock trigger results in tests, or `runWorkflowLocally()` for full-chain local workflow tests.
