import { createWorkflowJob } from "@tailor-platform/sdk";

export const validateOrder = createWorkflowJob({
  name: "validate-order",
  body: (input: { orderId: string; items: string[] }) => {
    const isValid = input.items.length > 0;
    return { orderId: input.orderId, isValid };
  },
});
