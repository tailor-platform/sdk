import { createResolver, t } from "@tailor-platform/sdk";
import { auth } from "../tailor.config";
import orderProcessingWorkflow from "../workflows/order-processing";

export default createResolver({
  name: "triggerOrderProcessing",
  description: "Trigger the order processing workflow",
  operation: "mutation",
  input: {
    orderId: t.string().description("Order ID to process"),
    customerId: t.string().description("Customer ID for the order"),
  },
  body: async ({ input }) => {
    // Trigger the workflow with authInvoker
    const workflowRunId = await orderProcessingWorkflow.trigger(
      {
        orderId: input.orderId,
        customerId: input.customerId,
      },
      { authInvoker: auth.invoker("manager-machine-user") },
    );

    return {
      workflowRunId,
      message: `Workflow triggered for order ${input.orderId}`,
    };
  },
  output: t.object({
    workflowRunId: t.string(),
    message: t.string(),
  }),
});
