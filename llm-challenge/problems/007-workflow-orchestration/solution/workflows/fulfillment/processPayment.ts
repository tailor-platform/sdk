import { createWorkflowJob } from "@tailor-platform/sdk";

export const processPayment = createWorkflowJob({
  name: "process-payment",
  body: (input: { orderId: string; amount: number }) => ({
    paid: true,
    transactionId: `txn-${input.orderId}`,
  }),
});
