import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const validateOrder = createWorkflowJob({
  name: "validate-order",
  body: (input: { orderId: string; amount: number }) => {
    if (input.amount <= 0) {
      throw new Error("Order amount must be positive");
    }
    return { valid: true, orderId: input.orderId };
  },
});

export const processPayment = createWorkflowJob({
  name: "process-payment",
  body: (input: { orderId: string; amount: number }) => {
    return {
      transactionId: `txn-${input.orderId}`,
      amount: input.amount,
      status: "completed" as const,
    };
  },
});

export const sendConfirmation = createWorkflowJob({
  name: "send-confirmation",
  body: (input: { orderId: string; transactionId: string }) => {
    return {
      orderId: input.orderId,
      transactionId: input.transactionId,
      confirmed: true,
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
      throw new Error("Order validation failed");
    }

    const payment = await processPayment.trigger({
      orderId: input.orderId,
      amount: input.amount,
    });

    const confirmation = await sendConfirmation.trigger({
      orderId: input.orderId,
      transactionId: payment.transactionId,
    });

    return {
      orderId: confirmation.orderId,
      transactionId: confirmation.transactionId,
      confirmed: confirmation.confirmed,
      paymentStatus: payment.status,
    };
  },
});

export default createWorkflow({
  name: "order-fulfillment",
  mainJob: fulfillOrder,
});
