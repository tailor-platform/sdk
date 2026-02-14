import {
  createExecutor,
  incomingWebhookTrigger,
  type IncomingWebhookRequest,
} from "@tailor-platform/sdk";

type PaymentWebhookRequest = IncomingWebhookRequest & {
  body: {
    eventType: string;
    paymentId: string;
    amount: number;
    currency: string;
  };
  headers: {
    "x-webhook-secret": string;
  };
};

export default createExecutor({
  name: "payment-webhook",
  description: "Handles incoming payment webhook notifications",
  trigger: incomingWebhookTrigger<PaymentWebhookRequest>(),
  operation: {
    kind: "function",
    body: async ({ body, headers }) => {
      console.log(`Payment ${body.eventType}: ${body.paymentId} - ${body.amount} ${body.currency}`);
    },
  },
});
