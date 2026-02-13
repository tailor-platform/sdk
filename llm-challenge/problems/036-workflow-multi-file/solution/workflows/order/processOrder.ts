import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { validateOrder } from "./validateOrder";
import { fulfillOrder } from "./fulfillOrder";

export const processOrder = createWorkflowJob({
  name: "process-order",
  body: (input: { orderId: string; items: string[] }) => {
    const validation = validateOrder.trigger({ orderId: input.orderId, items: input.items });
    const fulfillment = fulfillOrder.trigger({ orderId: input.orderId });
    return { validation, fulfillment };
  },
});

export { validateOrder, fulfillOrder };

export default createWorkflow({
  name: "order-processing",
  mainJob: processOrder,
});
