import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const calculateTotal = createWorkflowJob({
  name: "calculate-total",
  body: async (input: { quantity: number; unitPrice: number }) => ({
    total: input.quantity * input.unitPrice,
  }),
});

export const processOrder = createWorkflowJob({
  name: "process-order",
  body: async (input: { orderId: string; quantity: number; unitPrice: number }) => {
    const { total } = await calculateTotal.trigger({
      quantity: input.quantity,
      unitPrice: input.unitPrice,
    });
    return { orderId: input.orderId, total };
  },
});

export default createWorkflow({
  name: "order-flow",
  mainJob: processOrder,
});
