---
"@tailor-platform/sdk": major
"@tailor-platform/sdk-codemod": patch
---

Remove the pre-alignment `tailor.workflow` names `triggerWorkflow`, `triggerJobFunction`, and `resumeWorkflow` (and their `TriggerWorkflowOptions` / `TriggerJobFunctionOptions` option types) from `@tailor-platform/sdk/runtime`, the ambient `@tailor-platform/sdk/runtime/globals` types, and the `mockWorkflow()` test facade. Use the canonical names instead:

```diff
 import { workflow } from "@tailor-platform/sdk/runtime";

-await workflow.triggerWorkflow("myWorkflow", { data: "value" });
+await workflow.startWorkflow("myWorkflow", { data: "value" });
-workflow.triggerJobFunction("myJob", { data: "value" });
+workflow.startJobFunction("myJob", { data: "value" });
-await workflow.resumeWorkflow("execution-id");
+await workflow.resumeWorkflowExecution("execution-id");
```

Run the `v2/workflow-trigger-rename` codemod to migrate call sites automatically.
