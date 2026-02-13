import { createWorkflowJob } from "@tailor-platform/sdk";

export const fulfillOrder = createWorkflowJob({
  name: "fulfill-order",
  body: (input: { orderId: string }) => {
    return { orderId: input.orderId, status: "fulfilled" };
  },
});
