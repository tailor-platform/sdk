import { workflow } from "@tailor-platform/sdk/runtime";

export async function run(): Promise<string> {
  const executionId = await workflow.startWorkflow("myWorkflow", { data: "value" });
  return executionId;
}
