import { createResolver, t } from "@tailor-platform/sdk";
import orderProcessingWorkflow from "../workflows/order-processing";

export default createResolver({
  name: "startOrderProcessing",
  description: "Start the order processing workflow",
  operation: "mutation",
  input: {
    orderId: t.string().description("Order ID to process"),
    customerId: t.uuid().description("Customer ID for the order"),
  },
  body: async ({ input }) => {
    // Start the workflow with invoker (machine user name is type-narrowed via tailor.d.ts)
    const workflowRunId = await orderProcessingWorkflow.start(
      {
        orderId: input.orderId,
        customerId: input.customerId,
      },
      { invoker: "manager-machine-user" },
    );

    return {
      workflowRunId,
      message: `Workflow started for order ${input.orderId}`,
    };
  },
  output: t.object({
    workflowRunId: t.string(),
    message: t.string(),
  }),
});
