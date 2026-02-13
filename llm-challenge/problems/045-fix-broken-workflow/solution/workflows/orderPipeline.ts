import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const validatePayment = createWorkflowJob({
  name: "validate-payment",
  body: (input: { orderId: string; amount: number }) => {
    return { valid: input.amount > 0, orderId: input.orderId };
  },
});

export const shipOrder = createWorkflowJob({
  name: "ship-order",
  body: (input: { orderId: string }) => {
    return { shipped: true, orderId: input.orderId, trackingId: "TRK-001" };
  },
});

export const processOrder = createWorkflowJob({
  name: "process-order",
  body: (input: { orderId: string; amount: number }) => {
    const payment = validatePayment.trigger({ orderId: input.orderId, amount: input.amount });
    const shipping = shipOrder.trigger({ orderId: input.orderId });
    return { payment, shipping };
  },
});

export default createWorkflow({
  name: "order-pipeline",
  mainJob: processOrder,
});
