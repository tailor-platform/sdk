---
"@tailor-platform/sdk": patch
---

Refactor CLI waiter utilities: extract shared `formatWaitError` and `isRetryableWaitError` helpers into `cli/shared/wait-error.ts` to eliminate duplication between workflow and executor waiters. Clarify intent of safety-net fallbacks in `classifyWorkflowExecutionStatus` and `classifyExecutorJobStatus`. Simplify the `workflow wait` command run handler by removing the internal `emitWorkflowWaitResult` helper.
