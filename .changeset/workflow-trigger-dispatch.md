---
"@tailor-platform/sdk": major
---

Align workflow job `.start()` (previously `.trigger()`) with the platform runtime. Job starts now require a mocked workflow runtime in tests instead of running job bodies locally, and `start()` returns the job result directly instead of a Promise wrapper. Use `mockWorkflow()` to mock start results in tests, or `runWorkflowLocally()` for full-chain local workflow tests.
