import { createExecutor, incomingWebhookTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "external-webhook",
  description: "Handles incoming webhook events",
  trigger: incomingWebhookTrigger<{
    body: { event: string; payload: Record<string, unknown> };
    headers: Record<string, string>;
  }>(),
  operation: {
    kind: "function",
    body: (args) => {
      console.log("Webhook event:", args.body.event);
      console.log("Payload:", args.body.payload);
      console.log("Headers:", args.headers);
    },
  },
});
