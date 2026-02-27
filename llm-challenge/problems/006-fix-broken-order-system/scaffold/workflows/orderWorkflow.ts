import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

const validateOrder = createWorkflowJob({
  name: "validate-order",
  body: (input: { orderId: string; amount: number }) => {
    return {
      valid: input.amount > 0,
      orderId: input.orderId,
    };
  },
});

const processPayment = createWorkflowJob({
  name: "validate-order",
  body: (input: { orderId: string; amount: number }) => {
    return {
      transactionId: `txn-${input.orderId}`,
      amount: input.amount,
    };
  },
});

const shipOrder = createWorkflowJob({
  name: "ship_order",
  body: (input: { orderId: string }) => {
    return {
      shipped: true,
      trackingId: `TRK-${input.orderId}`,
    };
  },
});

const fulfillOrder = createWorkflowJob({
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
    };
  },
});

export default createWorkflow({
  name: "order_fulfillment",
  mainJob: fulfillOrder,
});
