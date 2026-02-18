import { createWorkflowJob } from "@tailor-platform/sdk";

export const shipOrder = createWorkflowJob({
  name: "ship-order",
  body: (input: { orderId: string }) => ({
    shipped: true,
    orderId: input.orderId,
    trackingId: "TRK-001",
  }),
});
