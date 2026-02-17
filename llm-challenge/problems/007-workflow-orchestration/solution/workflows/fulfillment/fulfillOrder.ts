import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { checkInventory } from "./checkInventory";
import { processPayment } from "./processPayment";
import { shipOrder } from "./shipOrder";

export const fulfillOrder = createWorkflowJob({
  name: "fulfill-order",
  body: (input: { orderId: string; amount: number }) => {
    const inventory = checkInventory.trigger({ orderId: input.orderId });
    const payment = processPayment.trigger({
      orderId: input.orderId,
      amount: input.amount,
    });
    const shipping = shipOrder.trigger({ orderId: input.orderId });
    return { inventory, payment, shipping };
  },
});

export { checkInventory, processPayment, shipOrder };

export default createWorkflow({
  name: "order-fulfillment",
  mainJob: fulfillOrder,
});
