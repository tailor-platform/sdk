import { createExecutor, incomingWebhookTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "payment-received",
  description: "Processes incoming payment webhook notifications",
  trigger: incomingWebhookTrigger<{
    body: { paymentId: string; amount: number; orderId: string };
    headers: Record<string, string>;
  }>(),
  operation: {
    kind: "function",
    body: async (args) => {
      const signature = args.headers["x-webhook-signature"];
      if (!signature || signature === "") {
        console.error("Missing webhook signature");
        return;
      }
      console.log(
        `Payment received: ${args.body.paymentId} for order ${args.body.orderId}, amount: ${args.body.amount}`,
      );
    },
  },
});
