---
"@tailor-platform/sdk": patch
---

feat: add workflow executor support

Added `kind: "workflow"` operation to executors, enabling direct workflow execution from schedule triggers or record triggers.

```typescript
import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";
import sampleWorkflow from "../workflows/sample";

export default createExecutor({
  name: "daily-workflow",
  trigger: scheduleTrigger({
    cron: "0 12 * * *",
    timezone: "Asia/Tokyo",
  }),
  operation: {
    kind: "workflow",
    workflow: sampleWorkflow,
    args: () => ({ orderId: "daily-workflow-order" }),
  },
});
```

- `workflow`: The workflow to execute (default export)
- `args`: Arguments to pass to the workflow's mainJob (static value or function)
- `authInvoker`: Optional authentication configuration
