import { createWorkflowJob } from "@tailor-platform/sdk";

type ProcessPaymentInput = {
  email: string;
  amount: number;
  priority: string;
};

type ProcessPaymentOutput = {
  transactionId: string;
  status: "completed";
  amount: number;
};

export const processPayment = createWorkflowJob({
  name: "process-payment",
  body: (input: ProcessPaymentInput): ProcessPaymentOutput => {
    const transactionId = `txn-${input.amount}-${input.priority}`;
    return {
      transactionId,
      status: "completed",
      amount: input.amount,
    };
  },
});
