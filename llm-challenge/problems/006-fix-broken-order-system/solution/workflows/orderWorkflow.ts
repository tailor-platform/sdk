import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const validateOrder = createWorkflowJob({
  name: "validate-order",
  body: (input: { orderId: string; amount: number }) => {
    return {
      valid: input.amount > 0,
      orderId: input.orderId,
    };
  },
});

export const processPayment = createWorkflowJob({
  name: "process-payment",
  body: (input: { orderId: string; amount: number }) => {
    return {
      transactionId: `txn-${input.orderId}`,
      amount: input.amount,
    };
  },
});

export const shipOrder = createWorkflowJob({
  name: "ship-order",
  body: (input: { orderId: string }) => {
    return {
      shipped: true,
      trackingId: `TRK-${input.orderId}`,
    };
  },
});

export const fulfillOrder = createWorkflowJob({
  name: "fulfill-order",
  body: async (input: { orderId: string; amount: number }) => {
    const validation = await validateOrder.trigger({
      orderId: input.orderId,
      amount: input.amount,
    });

    if (!validation.valid) {
      return { success: false };
    }

    const payment = await processPayment.trigger({
      orderId: input.orderId,
      amount: input.amount,
    });

    const shipping = await shipOrder.trigger({
      orderId: input.orderId,
    });

    return {
      success: true,
      transactionId: payment.transactionId,
      trackingId: shipping.trackingId,
    };
  },
});

export default createWorkflow({
  name: "order-fulfillment",
  mainJob: fulfillOrder,
});
