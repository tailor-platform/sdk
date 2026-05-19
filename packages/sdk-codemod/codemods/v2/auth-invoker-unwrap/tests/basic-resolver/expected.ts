import { createResolver, t } from "@tailor-platform/sdk";
import orderProcessingWorkflow from "../workflows/order-processing";

export default createResolver({
  name: "triggerWorkflow",
  type: "Mutation",
  input: {
    orderId: t.string().description("Order ID"),
    customerId: t.string().description("Customer ID for the order"),
  },
  body: async ({ input }) => {
    const workflowRunId = await orderProcessingWorkflow.trigger(
      {
        orderId: input.orderId,
        customerId: input.customerId,
      },
      { authInvoker: "manager-machine-user" },
    );
    return workflowRunId;
  },
});
