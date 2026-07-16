import { workflow } from "@tailor-platform/sdk/runtime";

const invoker = { namespace: "my-auth", machineUserName: "admin" };

export async function runShorthand(): Promise<string> {
  return await workflow.startWorkflow("myWorkflow", { data: "value" }, { authInvoker: invoker });
}

export async function runExplicitKey(): Promise<string> {
  return await workflow.startWorkflow(
    "myWorkflow",
    { data: "value" },
    { authInvoker: { namespace: "my-auth", machineUserName: "admin" } },
  );
}
