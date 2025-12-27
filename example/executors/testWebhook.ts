import { createExecutor, incomingWebhookTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "test-webhook",
  description: "Test executor for incoming webhook trigger",
  trigger: incomingWebhookTrigger<{
    body: { message: string };
    headers: Record<string, string>;
  }>(),
  operation: {
    kind: "function",
    body: (args) => {
      console.log("Webhook received:", args.body);
      console.log("Headers:", args.headers);
    },
  },
});
