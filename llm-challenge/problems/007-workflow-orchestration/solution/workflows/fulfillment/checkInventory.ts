import { createWorkflowJob } from "@tailor-platform/sdk";

export const checkInventory = createWorkflowJob({
  name: "check-inventory",
  body: (input: { orderId: string }) => ({
    available: true,
    orderId: input.orderId,
  }),
});
