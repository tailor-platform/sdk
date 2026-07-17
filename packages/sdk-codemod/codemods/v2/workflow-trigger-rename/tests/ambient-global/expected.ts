import "@tailor-platform/sdk/runtime/globals";

export async function run(): Promise<void> {
  await tailor.workflow.startWorkflow("myWorkflow", { data: "value" });
  tailor.workflow.startJobFunction("myJob", { data: "value" });
  await tailor.workflow.resumeWorkflowExecution("execution-id");
}
