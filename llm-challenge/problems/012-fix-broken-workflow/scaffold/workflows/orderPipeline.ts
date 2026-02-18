import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

const validatePayment = createWorkflowJob({
  name: "validate-payment",
  body: (input: { orderId: string; amount: number }) => {
    return { valid: input.amount > 0, orderId: input.orderId };
  },
});

const shipOrder = createWorkflowJob({
  name: "ship-order",
  body: (input: { orderId: string }) => {
    return { shipped: true, trackingId: "TRK-001" };
  },
});

const processOrder = createWorkflowJob({
  name: "validate-payment",
  body: async (input: { orderId: string; amount: number }) => {
    const payment = await validatePayment.trigger({ orderId: input.orderId, amount: input.amount });
    const shipping = await shipOrder.trigger({ orderId: input.orderId });
    return { payment, shipping };
  },
});

const orderPipeline = createWorkflow({
  name: "order_pipeline",
  mainJob: processOrder,
});
