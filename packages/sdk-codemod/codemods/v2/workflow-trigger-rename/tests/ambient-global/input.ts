import "@tailor-platform/sdk/runtime/globals";

export async function run(): Promise<void> {
  await tailor.workflow.triggerWorkflow("myWorkflow", { data: "value" });
  tailor.workflow.triggerJobFunction("myJob", { data: "value" });
  await tailor.workflow.resumeWorkflow("execution-id");
}
