import { workflow as wf } from "@tailor-platform/sdk/runtime";

export async function resume(executionId: string): Promise<string> {
  return await wf.resumeWorkflowExecution(executionId);
}
