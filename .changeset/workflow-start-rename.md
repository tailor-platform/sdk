---
"@tailor-platform/sdk": major
"@tailor-platform/create-sdk": major
"@tailor-platform/sdk-codemod": patch
---

Rename `Workflow.trigger()` (returned by `createWorkflow()`) and `WorkflowJob.trigger()` (returned by `createWorkflowJob()`) to `.start()`, aligning the SDK's ergonomic verb with the platform's `start*` RPC vocabulary:

```diff
 const inventory = checkInventory.trigger({ orderId: input.orderId });
+const inventory = checkInventory.start({ orderId: input.orderId });

-const workflowRunId = await orderProcessingWorkflow.trigger(args, { invoker: "manager" });
+const workflowRunId = await orderProcessingWorkflow.start(args, { invoker: "manager" });
```

`mockWorkflow()`'s `wf.job(definition)` / `wf.workflow(definition)` now return a mock of the `.start` method, and `wf.setTriggerHandler` / `wf.triggeredJobs` are renamed to `wf.setStartHandler` / `wf.startedJobs`. No codemod ships for the `.trigger()` → `.start()` call-site rename itself — see the `v2/workflow-start-rename` migration guide entry for manual migration steps.
