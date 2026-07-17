import { workflow } from "@tailor-platform/sdk/runtime";

const options = { invoker: { namespace: "my-auth", machineUserName: "admin" } };

export async function runWithVariable(): Promise<string> {
  return await workflow.triggerWorkflow("myWorkflow", { data: "value" }, options);
}

export async function runWithSpread(): Promise<string> {
  const extra = { invoker: { namespace: "my-auth", machineUserName: "admin" } };
  return await workflow.triggerWorkflow("myWorkflow", { data: "value" }, { ...extra });
}
