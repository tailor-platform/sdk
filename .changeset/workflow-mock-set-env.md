---
"@tailor-platform/sdk": minor
"@tailor-platform/create-sdk": patch
---

Add `workflowMock.setEnv()` to control the `env` value passed to job bodies when `createWorkflowJob().trigger()` is invoked locally. Tests using the `tailor-runtime` Vitest environment can now configure the env through the same `workflowMock` helper they use for `setJobHandler` / `setWaitHandler`, without touching `process.env`.

```typescript
import { workflowMock } from "@tailor-platform/sdk/vitest";

test("workflow.mainJob.trigger() executes all jobs", async () => {
  workflowMock.setEnv({ STAGE: "test" });
  await workflow.mainJob.trigger({ orderId: "order-1", amount: 100 });
});
```

The previous env-var-based pattern is now deprecated. A non-breaking fallback is retained, but `workflowMock.setEnv()` takes priority when both are set.
