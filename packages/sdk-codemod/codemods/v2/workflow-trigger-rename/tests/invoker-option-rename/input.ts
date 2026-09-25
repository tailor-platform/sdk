import { workflow } from "@tailor-platform/sdk/runtime";

const invoker = { namespace: "my-auth", machineUserName: "admin" };

export async function runShorthand(): Promise<string> {
  return await workflow.triggerWorkflow("myWorkflow", { data: "value" }, { invoker });
}

export async function runExplicitKey(): Promise<string> {
  return await workflow.triggerWorkflow(
    "myWorkflow",
    { data: "value" },
    { invoker: { namespace: "my-auth", machineUserName: "admin" } },
  );
}
