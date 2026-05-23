import { createExecutor, incomingWebhookTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "external-sync",
  description: "External sync webhook receiver",
  trigger: incomingWebhookTrigger<{
    body: { payload: string };
    headers: Record<string, string>;
  }>({
    response: () => ({ ok: true }),
  }),
  operation: {
    kind: "function",
    body: async (args) => {
      console.log("webhook payload:", args.body.payload);
    },
  },
});
