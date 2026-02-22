import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { validateInput } from "./validateInput";
import { enrichData } from "./enrichData";
import { processPayment } from "./processPayment";

type OrchestrationInput = {
  email: string;
  amount: number;
  items: { name: string; price: number }[];
};

export const sendConfirmation = createWorkflowJob({
  name: "send-confirmation",
  body: (input: { email: string; transactionId: string; amount: number }) => ({
    sent: true,
    recipient: input.email,
    transactionId: input.transactionId,
  }),
});

export const orchestrate = createWorkflowJob({
  name: "orchestrate-pipeline",
  body: async (input: OrchestrationInput) => {
    // Step 1: Validate
    const validation = await validateInput.trigger({
      email: input.email,
      amount: input.amount,
      items: input.items,
    });

    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors,
      };
    }

    // Step 2: Enrich
    const enriched = await enrichData.trigger({
      email: input.email,
      amount: input.amount,
      items: input.items,
    });

    // Step 3: Process payment
    const payment = await processPayment.trigger({
      email: enriched.email,
      amount: enriched.amount,
      priority: enriched.priority,
    });

    // Step 4: Send confirmation
    const confirmation = await sendConfirmation.trigger({
      email: input.email,
      transactionId: payment.transactionId,
      amount: payment.amount,
    });

    return {
      success: true,
      enriched: {
        itemCount: enriched.itemCount,
        averagePrice: enriched.averagePrice,
        priority: enriched.priority,
      },
      payment: {
        transactionId: payment.transactionId,
        status: payment.status,
      },
      confirmation: {
        sent: confirmation.sent,
        recipient: confirmation.recipient,
      },
    };
  },
});

// Re-export all jobs for the workflow engine
export { validateInput } from "./validateInput";
export { enrichData } from "./enrichData";
export { processPayment } from "./processPayment";

export default createWorkflow({
  name: "order-pipeline",
  mainJob: orchestrate,
});
