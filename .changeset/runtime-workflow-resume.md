---
"@tailor-platform/sdk": minor
---

Add `workflow.resumeWorkflow(executionId)` to `@tailor-platform/sdk/runtime` for resuming a failed or pending-retry workflow execution from user code. `mockWorkflow()` in `@tailor-platform/sdk/vitest` gains a matching `resumeWorkflow` `vi.fn` and `setResumeHandler` helper for tests.
