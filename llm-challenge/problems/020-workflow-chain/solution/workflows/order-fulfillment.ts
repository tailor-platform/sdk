import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const checkInventory = createWorkflowJob({
  name: "check-inventory",
  body: (input: { orderId: string }) => ({
    available: true,
    orderId: input.orderId,
  }),
});

export const processPayment = createWorkflowJob({
  name: "process-payment",
  body: (input: { orderId: string; amount: number }) => ({
    paid: true,
    transactionId: `txn-${input.orderId}`,
  }),
});

export const fulfillOrder = createWorkflowJob({
  name: "fulfill-order",
  body: (input: { orderId: string; amount: number }) => {
    const inventory = checkInventory.trigger({ orderId: input.orderId });
    const payment = processPayment.trigger({
      orderId: input.orderId,
      amount: input.amount,
    });
    return {
      orderId: input.orderId,
      inventory,
      payment,
    };
  },
});

export default createWorkflow({
  name: "order-fulfillment",
  mainJob: fulfillOrder,
});
