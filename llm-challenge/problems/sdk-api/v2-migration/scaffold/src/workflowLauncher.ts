import { auth } from "../tailor.config";

export async function launchWorkflow(workflow: {
  trigger(input: { customerId: string }, options: { authInvoker: unknown }): Promise<string>;
}): Promise<string> {
  return await workflow.trigger(
    { customerId: "customer-1" },
    { authInvoker: auth.invoker("batch-worker") },
  );
}
